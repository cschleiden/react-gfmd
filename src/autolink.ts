import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { parseWithRemark } from "./remark";
import { gfmSchema } from "./schema";

const autolinkPluginKey = new PluginKey("gfmd-autolink");
const nonWhitespacePattern = /\S+/g;

interface AutolinkRange {
  from: number;
  to: number;
  href: string;
  tokenFrom: number;
  tokenTo: number;
}

export function createAutolinkPlugin() {
  return new Plugin({
    key: autolinkPluginKey,
    appendTransaction(transactions, _oldState, newState) {
      if (
        !transactions.some((transaction) => transaction.docChanged) ||
        transactions.some((transaction) =>
          transaction.getMeta(autolinkPluginKey),
        )
      ) {
        return null;
      }

      const changedRanges = transactionChangedRanges(transactions);
      const pasted = transactions.some(
        (transaction) => transaction.getMeta("uiEvent") === "paste",
      );
      if (pasted) {
        return autolinkDocument(newState.doc, newState.tr, changedRanges);
      }

      const { $from, empty } = newState.selection;
      if (
        !empty ||
        !$from.parent.isTextblock ||
        !/\s/.test(
          $from.parent.textBetween(
            Math.max(0, $from.parentOffset - 1),
            $from.parentOffset,
          ),
        )
      ) {
        return null;
      }

      return autolinkDocument(newState.doc, newState.tr, changedRanges);
    },
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "Enter" || !view.state.selection.empty) return false;
        applyAutolinksAtCursor(view);
        return false;
      },
    },
  });
}

function applyAutolinksAtCursor(view: EditorView) {
  const { $from } = view.state.selection;
  if (!$from.parent.isTextblock) return;

  const transaction = autolinkTokenBefore(
    $from.parent,
    $from.start(),
    $from.parentOffset,
    view.state.tr,
  );
  if (transaction) view.dispatch(transaction);
}

function autolinkDocument(
  doc: ProseMirrorNode,
  transaction: Transaction,
  changedRanges: ChangedRange[],
) {
  doc.descendants((node, position) => {
    if (node.isTextblock) {
      addAutolinks(node, position + 1, transaction, changedRanges);
      return false;
    }
    return true;
  });
  return finishAutolinkTransaction(transaction);
}

function autolinkTokenBefore(
  node: ProseMirrorNode,
  start: number,
  cursorOffset: number,
  transaction: Transaction,
) {
  const run = textRunBefore(node, cursorOffset);
  if (!run) return null;

  const beforeCursor = run.text.slice(0, cursorOffset - run.from);
  const tokenEnd = beforeCursor.search(/\s+$/);
  const contentEnd = tokenEnd === -1 ? beforeCursor.length : tokenEnd;
  const tokenStartMatch = beforeCursor.slice(0, contentEnd).match(/\S+$/);
  const tokenStart = tokenStartMatch?.index ?? contentEnd;
  const token = beforeCursor.slice(tokenStart, contentEnd);

  for (const range of autolinkRanges(token)) {
    const from = start + run.from + tokenStart + range.from;
    const to = start + run.from + tokenStart + range.to;
    if (!canAutolink(transaction.doc, from, to)) continue;
    transaction.addMark(
      from,
      to,
      gfmSchema.marks.link.create({ href: range.href, title: null }),
    );
  }
  return finishAutolinkTransaction(transaction);
}

function addAutolinks(
  textblock: ProseMirrorNode,
  start: number,
  transaction: Transaction,
  changedRanges: ChangedRange[],
) {
  textblock.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    const nodeFrom = start + position;
    const nodeTo = nodeFrom + node.text.length;
    if (!changedRanges.some((range) => touches(range, nodeFrom, nodeTo))) {
      return;
    }

    for (const range of autolinkRanges(node.text)) {
      const tokenFrom = nodeFrom + range.tokenFrom;
      const tokenTo = nodeFrom + range.tokenTo;
      if (
        !changedRanges.some((changed) =>
          touches(changed, tokenFrom, tokenTo),
        )
      ) {
        continue;
      }
      const from = nodeFrom + range.from;
      const to = nodeFrom + range.to;
      if (!canAutolink(transaction.doc, from, to)) continue;
      transaction.addMark(
        from,
        to,
        gfmSchema.marks.link.create({ href: range.href, title: null }),
      );
    }
  });
}

function finishAutolinkTransaction(transaction: Transaction) {
  if (!transaction.docChanged) return null;
  return transaction.setMeta(autolinkPluginKey, true);
}

export function autolinkRanges(text: string): AutolinkRange[] {
  const ranges: AutolinkRange[] = [];

  for (const match of text.matchAll(nonWhitespacePattern)) {
    if (match.index === undefined) continue;
    const token = match[0];
    const parsed = parseWithRemark(token);
    if (parsed.textContent !== token || parsed.childCount !== 1) continue;

    const paragraph = parsed.firstChild;
    if (!paragraph?.isTextblock) continue;

    let offset = 0;
    paragraph.forEach((child) => {
      const length = child.text?.length ?? 0;
      const link = gfmSchema.marks.link.isInSet(child.marks);
      if (length && link) {
        ranges.push({
          from: match.index! + offset,
          to: match.index! + offset + length,
          href: String(link.attrs.href),
          tokenFrom: match.index!,
          tokenTo: match.index! + token.length,
        });
      }

      offset += length;
    });
  }

  return ranges;
}

interface ChangedRange {
  from: number;
  to: number;
}

function transactionChangedRanges(
  transactions: readonly Transaction[],
): ChangedRange[] {
  const maps = transactions.flatMap((transaction) => transaction.mapping.maps);
  const ranges: ChangedRange[] = [];

  maps.forEach((map, mapIndex) => {
    map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      let from = newFrom;
      let to = newTo;
      for (let index = mapIndex + 1; index < maps.length; index += 1) {
        from = maps[index].map(from, -1);
        to = maps[index].map(to, 1);
      }
      ranges.push({ from: Math.min(from, to), to: Math.max(from, to) });
    });
  });

  return ranges;
}

function touches(range: ChangedRange, from: number, to: number) {
  return from <= range.to && to >= range.from;
}

function canAutolink(doc: ProseMirrorNode, from: number, to: number) {
  return (
    !doc.rangeHasMark(from, to, gfmSchema.marks.link) &&
    !doc.rangeHasMark(from, to, gfmSchema.marks.code)
  );
}

function textRunBefore(node: ProseMirrorNode, cursorOffset: number) {
  let text = "";
  let from = cursorOffset;

  for (let index = node.childCount - 1; index >= 0; index -= 1) {
    const child = node.child(index);
    let childFrom = 0;
    for (let previous = 0; previous < index; previous += 1) {
      childFrom += node.child(previous).nodeSize;
    }
    if (childFrom >= cursorOffset) continue;
    if (!child.isText || !child.text) break;

    const available = child.text.slice(
      0,
      Math.min(child.text.length, cursorOffset - childFrom),
    );
    text = available + text;
    from = childFrom;
  }

  return text ? { from, text } : null;
}
