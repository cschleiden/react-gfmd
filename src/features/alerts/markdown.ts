import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";
import type { AlertKind } from "../../types";

export const alertKinds = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
export const alertStartPattern = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;

export interface AlertParseResult {
  node: ProseMirrorNode;
  nextIndex: number;
}

export function parseAlertBlock(
  schema: Schema,
  lines: string[],
  index: number,
  parseParagraphs: (markdown: string) => ProseMirrorNode[],
): AlertParseResult | undefined {
  const alertMatch = lines[index]?.match(alertStartPattern);
  if (!alertMatch) return undefined;

  const kind = alertMatch[1].toUpperCase() as AlertKind;
  let nextIndex = index + 1;
  const bodyLines: string[] = [];

  while (nextIndex < lines.length && lines[nextIndex]?.startsWith(">")) {
    bodyLines.push(lines[nextIndex].replace(/^>\s?/, ""));
    nextIndex += 1;
  }

  return {
    node: schema.nodes.alert.create(
      { kind },
      parseParagraphs(bodyLines.join("\n")) || [schema.nodes.paragraph.create()],
    ),
    nextIndex,
  };
}

export function serializeAlertBlock(node: ProseMirrorNode, serializeBlockContent: (node: ProseMirrorNode) => string) {
  const kind = String(node.attrs.kind ?? "NOTE").toUpperCase();
  const body = serializeBlockContent(node).trimEnd();
  const quoted = body
    ? body
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n")
    : ">";

  return `> [!${kind}]\n${quoted}`;
}
