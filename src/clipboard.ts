import { Fragment, Slice } from "prosemirror-model";
import { Plugin, type Selection } from "prosemirror-state";
import { isListNode } from "./lists/utils";
import { parseMarkdown, serializeMarkdown } from "./markdown";
import { gfmSchema } from "./schema";

export function createMarkdownClipboardPlugin() {
  return new Plugin({
    props: {
      clipboardTextParser: (text) => parseMarkdownClipboardText(text),
      clipboardTextSerializer: (slice, view) =>
        serializeMarkdownClipboardSlice(slice, view.state.selection),
    },
  });
}

export function parseMarkdownClipboardText(markdown: string) {
  return Slice.maxOpen(parseMarkdown(markdown).content, true);
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
