import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";

export const referenceTokenPattern =
  /\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)\b|\bGH-(\d+)\b|(?<![\w/])#(\d+)\b/;

export function parseReferenceToken(schema: Schema, raw: string): ProseMirrorNode | undefined {
  const match = raw.match(new RegExp(`^${referenceTokenPattern.source}$`));
  if (!match) return undefined;

  if (match[1] && match[2] && match[3]) {
    return schema.nodes.reference.create({
      owner: match[1],
      repo: match[2],
      number: Number(match[3]),
      raw,
    });
  }

  return schema.nodes.reference.create({
    number: Number(match[4] ?? match[5]),
    raw,
  });
}

export function serializeReferenceNode(node: ProseMirrorNode) {
  return node.attrs.raw ?? `#${node.attrs.number}`;
}
