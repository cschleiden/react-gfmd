import type { Node as ProseMirrorNode, Schema } from "prosemirror-model";

export const mentionTokenPattern = /(?<![\w/])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)/;

export function parseMentionToken(schema: Schema, raw: string): ProseMirrorNode | undefined {
  const match = raw.match(new RegExp(`^${mentionTokenPattern.source}$`));
  if (!match) return undefined;
  return schema.nodes.mention.create({ username: match[1] });
}

export function serializeMentionNode(node: ProseMirrorNode) {
  return `@${node.attrs.username}`;
}
