import type { Fragment, Node as ProseMirrorNode } from "prosemirror-model";
import { placeFootnoteDefinitionsAtDocumentEnd } from "./features/footnotes/model";
import {
  parseInlineText,
  parseWithRemark,
  serializeWithRemark,
} from "./remark";
import { gfmSchema } from "./schema";
import type { EditorContext } from "./types";

export function parseMarkdown(
  markdown: string,
  context?: EditorContext,
): ProseMirrorNode {
  if (!markdown.trim()) {
    return gfmSchema.nodes.doc.create(null, [
      gfmSchema.nodes.paragraph.create(),
    ]);
  }

  return placeFootnoteDefinitionsAtDocumentEnd(
    parseWithRemark(markdown, context),
  );
}

export function serializeMarkdown(doc: ProseMirrorNode): string {
  return serializeWithRemark(doc);
}

export function parseInline(text: string): Fragment {
  return gfmSchema.nodes.paragraph.create(null, parseInlineText(text)).content;
}
