import { Fragment, Slice } from "prosemirror-model";
import { closeHistory } from "prosemirror-history";
import { Plugin, type Selection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { isListNode } from "./lists/utils";
import { parseMarkdown, serializeMarkdown } from "./markdown";
import { gfmSchema } from "./schema";
import type { EditorContext } from "./types";

export function createMarkdownClipboardPlugin(context: EditorContext) {
  let pendingClipboardChange = false;
  let pendingReset: ReturnType<typeof globalThis.setTimeout> | null = null;

  return new Plugin({
    appendTransaction: (transactions, _oldState, newState) => {
      const taggedClipboardChange = transactions.some((transaction) =>
        ["cut", "drop", "paste"].includes(
          String(transaction.getMeta("uiEvent")),
        ),
      );
      const pendingDocumentChange =
        pendingClipboardChange &&
        transactions.some((transaction) => transaction.docChanged);
      if (!taggedClipboardChange && !pendingDocumentChange) {
        return null;
      }

      clearPendingClipboardChange();
      return closeHistory(newState.tr);
    },
    props: {
      clipboardTextParser: (text) => parseMarkdownClipboardText(text, context),
      clipboardTextSerializer: (slice, view) =>
        serializeMarkdownClipboardSlice(slice, view.state.selection),
      handleDrop: (view, _event, slice) => {
        if (slice.size) closeHistoryBeforeClipboardChange(view);
        return false;
      },
      handleDOMEvents: {
        cut: (view) =>
          view.state.selection.empty
            ? false
            : closeHistoryBeforeClipboardChange(view),
        paste: (view) =>
          view.composing ? closeHistoryBeforeClipboardChange(view) : false,
      },
      handlePaste: (view, _event, slice) => {
        if (slice.size) closeHistoryBeforeClipboardChange(view);
        return false;
      },
    },
  });

  function closeHistoryBeforeClipboardChange(view: EditorView) {
    pendingClipboardChange = true;
    if (pendingReset !== null) globalThis.clearTimeout(pendingReset);
    pendingReset = globalThis.setTimeout(clearPendingClipboardChange, 0);
    view.dispatch(closeHistory(view.state.tr));
    return false;
  }

  function clearPendingClipboardChange() {
    pendingClipboardChange = false;
    if (pendingReset !== null) globalThis.clearTimeout(pendingReset);
    pendingReset = null;
  }
}

export function parseMarkdownClipboardText(
  markdown: string,
  context?: EditorContext,
) {
  return Slice.maxOpen(parseMarkdown(markdown, context).content, true);
}

export function serializeMarkdownClipboardSlice(
  slice: Slice,
  selection?: Selection,
) {
  if (!slice.content.size) return "";

  const content = standaloneClipboardContent(slice, selection);
  const doc = gfmSchema.topNodeType.create(null, content);
  return serializeMarkdown(doc);
}

function standaloneClipboardContent(slice: Slice, selection?: Selection) {
  let { content, openStart, openEnd } = slice;
  let depth = 1;

  while (
    openStart > 1 &&
    openEnd > 1 &&
    content.childCount === 1
  ) {
    const node = content.firstChild;
    if (node && isListNode(node) && node.childCount > 1) {
      break;
    }
    if (!node) break;

    content = node.content;
    openStart -= 1;
    openEnd -= 1;
    depth += 1;
  }

  const first = content.firstChild;
  if (first?.isInline) {
    return Fragment.from(gfmSchema.nodes.paragraph.create(null, content));
  }

  if (
    first?.type === gfmSchema.nodes.ordered_list &&
    selection &&
    selection.$from.depth >= depth &&
    selection.$from.node(depth).type === first.type
  ) {
    const order =
      Number(first.attrs.order) + selection.$from.index(depth);
    content = content.replaceChild(
      0,
      first.type.createChecked(
        { ...first.attrs, order },
        first.content,
        first.marks,
      ),
    );
  }

  return content;
}
