import type {
  Html,
  Parent as MdastParent,
  PhrasingContent,
  Root,
  Text,
} from "mdast";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type {
  FromProseMirrorState,
  HandlerState,
} from "../../mdast-utils";
import { gfmSchema } from "../../schema";
import type { Position } from "unist";
import { emojiDefinition } from "./data";

interface EmojiShortcode {
  emoji: string | null;
  imageUrl: string | null;
  literal: boolean;
  name: string;
  position?: Position;
  shortcode: string;
  type: "emojiShortcode";
}

declare module "mdast" {
  interface PhrasingContentMap {
    emojiShortcode: EmojiShortcode;
  }

  interface RootContentMap {
    emojiShortcode: EmojiShortcode;
  }
}

const emojiPattern = /(^|[^\w:])(:([+\-\w]+):)(?=$|[^\w:])/g;

export function createRemarkEmojiShortcodes() {
  return function remarkEmojiShortcodes() {
    return (tree: Root, file: { value: unknown }) => {
      transformEmojiText(tree, String(file.value));
    };
  };
}

export function parseEmojiShortcode(
  node: EmojiShortcode,
  _parent: MdastParent,
  _state: HandlerState,
) {
  return gfmSchema.nodes.emoji_shortcode.create({
    emoji: node.emoji,
    imageUrl: node.imageUrl,
    literal: node.literal,
    name: node.name,
    shortcode: node.shortcode,
  });
}

export function emojiShortcodeToMdast(
  node: ProseMirrorNode,
  _parent: ProseMirrorNode | undefined,
  _state: FromProseMirrorState,
): Html {
  // Use a raw mdast leaf so remark-stringify cannot escape shortcode characters.
  return { type: "html", value: String(node.attrs.shortcode) };
}

export function emojiShortcodeNode(name: string) {
  const definition = emojiDefinition(name);
  return definition
    ? gfmSchema.nodes.emoji_shortcode.create({
        ...definition,
        literal: false,
        shortcode: `:${name}:`,
      })
    : null;
}

function transformEmojiText(parent: MdastParent | Root, source: string) {
  if (isPhrasingParent(parent)) {
    const phrasingParent = parent as unknown as {
      children: PhrasingContent[];
    };
    phrasingParent.children = phrasingParent.children.flatMap((child) =>
      child.type === "text" ? emojiNodesFromText(child, source) : child,
    );
  }

  for (const child of parent.children) {
    if ("children" in child) transformEmojiText(child, source);
  }
}

function emojiNodesFromText(node: Text, source: string): PhrasingContent[] {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  const sourceValue =
    typeof start === "number" && typeof end === "number"
      ? source.slice(start, end)
      : node.value;

  const output: PhrasingContent[] = [];
  let cursor = 0;
  let sourceCursor = 0;
  for (const match of node.value.matchAll(emojiPattern)) {
    if (match.index === undefined) continue;
    const prefix = match[1];
    const shortcode = match[2];
    const name = match[3];
    const definition = emojiDefinition(name);
    if (!definition) continue;
    const sourceIndex = sourceValue.indexOf(shortcode, sourceCursor);
    if (sourceIndex === -1 && sourceValue !== node.value) continue;
    const escaped =
      sourceIndex >= 0 && isEscaped(sourceValue, sourceIndex);
    sourceCursor =
      sourceIndex >= 0 ? sourceIndex + shortcode.length : sourceCursor;

    const emojiStart = match.index + prefix.length;
    if (emojiStart > cursor) {
      output.push({ type: "text", value: node.value.slice(cursor, emojiStart) });
    }
    output.push({
      ...definition,
      emoji: escaped ? null : definition.emoji,
      imageUrl: escaped ? null : definition.imageUrl,
      literal: escaped,
      shortcode: escaped ? `\\${shortcode}` : shortcode,
      type: "emojiShortcode",
    });
    cursor = emojiStart + shortcode.length;
  }

  if (cursor === 0) return [node];
  if (cursor < node.value.length) {
    output.push({ type: "text", value: node.value.slice(cursor) });
  }
  return output;
}

function isEscaped(value: string, index: number) {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function isPhrasingParent(
  parent: MdastParent | Root,
): parent is (MdastParent | Root) & { children: PhrasingContent[] } {
  return [
    "delete",
    "detailsSummary",
    "emphasis",
    "heading",
    "link",
    "paragraph",
    "safeHtmlInline",
    "strong",
    "tableCell",
  ].includes(parent.type);
}
