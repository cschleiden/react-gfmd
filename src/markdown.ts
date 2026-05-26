import type { Fragment, Node as ProseMirrorNode } from "prosemirror-model";
import { serializeAlertBlock } from "./features/alerts";
import { parseInlineText, parseWithRemark, serializeWithRemark } from "./markdown/remark";
import { gfmSchema } from "./schema";

export function parseMarkdown(markdown: string): ProseMirrorNode {
  if (!markdown.trim()) {
    return gfmSchema.nodes.doc.create(null, [gfmSchema.nodes.paragraph.create()]);
  }

  return parseWithRemark(markdown);
}

export function serializeMarkdown(doc: ProseMirrorNode): string {
  const blocks: string[] = [];

  doc.forEach((node) => {
    blocks.push(
      node.type.name === "alert"
        ? serializeAlertBlock(node, serializeAlertContent)
        : serializeWithRemark(gfmSchema.nodes.doc.create(null, [node])),
    );
  });

  return blocks.join("\n\n").trimEnd();
}

export function parseInline(text: string): Fragment {
  return gfmSchema.nodes.paragraph.create(null, parseInlineText(text)).content;
}

function serializeAlertContent(node: ProseMirrorNode): string {
  return serializeWithRemark(gfmSchema.nodes.doc.create(null, node.content));
}
