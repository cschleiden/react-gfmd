import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import { parseWithRemark } from "./remark";
import { gfmSchema } from "./schema";

const autolinkPluginKey = new PluginKey("gfmd-autolink");
const nonWhitespacePattern = /\S+/g;

interface AutolinkRange {
  from: number;
  to: number;
  href: string;
}

export function createAutolinkPlugin() {
  return new Plugin({
    key: autolinkPluginKey,
    appendTransaction(transactions, oldState, newState) {
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
      const { $from, empty } = newState.selection;
      const whitespaceBoundary =
        empty &&
        $from.parent.isTextblock &&
        /\s/.test(
          $from.parent.textBetween(
            Math.max(0, $from.parentOffset - 1),
            $from.parentOffset,
          ),
        );
      const blockBoundary =
        empty &&
        $from.parentOffset === 0 &&
        oldState.selection.$from.parentOffset > 0;
      const leafBoundary =
        empty && $from.nodeBefore?.type === gfmSchema.nodes.hard_break;

      if (!pasted && !whitespaceBoundary && !blockBoundary && !leafBoundary) {
        return null;
      }

      return autolinkChangedRanges(newState.doc, newState.tr, changedRanges);
    },
  });
}

function autolinkChangedRanges(
  doc: ProseMirrorNode,
  transaction: Transaction,
  changedRanges: ChangedRange[],
) {
  const visited = new Set<number>();

  for (const range of changedRanges) {
    const from = Math.max(0, range.from - 1);
    const to = Math.min(doc.content.size, range.to + 1);
    doc.nodesBetween(from, to, (node, position) => {
      if (!node.isTextblock || visited.has(position)) return true;
      visited.add(position);
      addAutolinks(node, position + 1, transaction, changedRanges);
      return false;
    });
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
    const ranges = autolinkRanges(node.text, (tokenFrom, tokenTo) =>
      changedRanges.some((changed) =>
        touches(changed, nodeFrom + tokenFrom, nodeFrom + tokenTo),
      ),
    );

    for (const range of ranges) {
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

export function autolinkRanges(
  text: string,
  includeToken: (from: number, to: number) => boolean = () => true,
): AutolinkRange[] {
  const ranges: AutolinkRange[] = [];

  for (const match of text.matchAll(nonWhitespacePattern)) {
    if (match.index === undefined) continue;
    const token = match[0];
    if (!includeToken(match.index, match.index + token.length)) continue;
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
