import type { Fragment, Node as ProseMirrorNode } from "prosemirror-model";
import {
  parseInlineText,
  parseWithRemark,
  serializeWithRemark,
} from "./remark";
import { gfmSchema } from "./schema";

export function parseMarkdown(markdown: string): ProseMirrorNode {
  if (!markdown.trim()) {
    return gfmSchema.nodes.doc.create(null, [
      gfmSchema.nodes.paragraph.create(),
    ]);
  }

  return parseWithRemark(markdown);
}

export function serializeMarkdown(doc: ProseMirrorNode): string {
  return serializeWithRemark(doc);
}

export function parseInline(text: string): Fragment {
  return gfmSchema.nodes.paragraph.create(null, parseInlineText(text)).content;
}
