import type { Fragment, Node as ProseMirrorNode } from "prosemirror-model";
import { alertStartPattern, parseAlertBlock, serializeAlertBlock } from "./features/alerts";
import { mentionTokenPattern, serializeMentionNode } from "./features/mentions";
import { referenceTokenPattern, serializeReferenceNode } from "./features/references";
import { parseInlineToken } from "./plugins/token-conversion";
import { gfmSchema } from "./schema";

const inlineTokenPattern = new RegExp(`${referenceTokenPattern.source}|${mentionTokenPattern.source}`, "g");

export function parseMarkdown(markdown: string): ProseMirrorNode {
  const blocks = parseBlocks(markdown.replace(/\r\n?/g, "\n"));

  return gfmSchema.nodes.doc.createAndFill(null, blocks) ?? gfmSchema.nodes.doc.create(null, [
    gfmSchema.nodes.paragraph.create(),
  ]);
}

export function serializeMarkdown(doc: ProseMirrorNode): string {
  const blocks: string[] = [];

  doc.forEach((node) => {
    if (node.type.name === "alert") {
      blocks.push(serializeAlertBlock(node, serializeBlockContent));
      return;
    }

    blocks.push(serializeNode(node));
  });

  return blocks.join("\n\n").trimEnd();
}

function parseBlocks(markdown: string): ProseMirrorNode[] {
  const lines = markdown.split("\n");
  const blocks: ProseMirrorNode[] = [];

  for (let index = 0; index < lines.length; ) {
    if (!lines[index]?.trim()) {
      index += 1;
      continue;
    }

    const alert = parseAlertBlock(gfmSchema, lines, index, parseParagraphs);
    if (alert) {
      blocks.push(alert.node);
      index = alert.nextIndex;
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index]?.trim() && !lines[index]?.match(alertStartPattern)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push(gfmSchema.nodes.paragraph.create(null, parseInline(paragraphLines.join(" "))));
  }

  return blocks.length ? blocks : [gfmSchema.nodes.paragraph.create()];
}

function parseParagraphs(markdown: string): ProseMirrorNode[] {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => gfmSchema.nodes.paragraph.create(null, parseInline(block.replace(/\n/g, " "))));
}

export function parseInline(text: string): Fragment {
  const nodes: ProseMirrorNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(inlineTokenPattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      nodes.push(gfmSchema.text(text.slice(lastIndex, match.index)));
    }

    const parsed = parseInlineToken(match[0]);
    if (parsed) nodes.push(parsed);

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(gfmSchema.text(text.slice(lastIndex)));
  }

  return gfmSchema.nodes.paragraph.create(null, nodes).content;
}

function serializeBlockContent(node: ProseMirrorNode): string {
  const parts: string[] = [];
  node.forEach((child) => parts.push(serializeNode(child)));
  return parts.join("\n\n");
}

function serializeNode(node: ProseMirrorNode): string {
  if (node.type.name === "paragraph") {
    return serializeInlineContent(node);
  }

  if (node.type.name === "alert") {
    return serializeMarkdown(gfmSchema.nodes.doc.create(null, [node]));
  }

  return node.textContent;
}

function serializeInlineContent(node: ProseMirrorNode): string {
  let markdown = "";
  node.forEach((child) => {
    if (child.isText) {
      markdown += child.text ?? "";
      return;
    }

    if (child.type.name === "reference") {
      markdown += serializeReferenceNode(child);
      return;
    }

    if (child.type.name === "mention") {
      markdown += serializeMentionNode(child);
    }
  });
  return markdown;
}
