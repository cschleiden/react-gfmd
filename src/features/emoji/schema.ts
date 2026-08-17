import type { NodeSpec } from "prosemirror-model";
import { emojiDefinition, emojiShortcode } from "./data";

export const emojiShortcodeNodeSpec: NodeSpec = {
  attrs: {
    emoji: { default: null },
    imageUrl: { default: null },
    literal: { default: false },
    name: { validate: "string" },
    shortcode: { validate: "string" },
  },
  atom: true,
  group: "inline",
  inline: true,
  selectable: true,
  parseDOM: [
    {
      tag: "[data-gfmd-emoji-shortcode]",
      getAttrs: (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const name = node.dataset.emojiName;
        if (!name) return false;
        const definition = emojiDefinition(name);
        if (!definition) return false;
        return {
          ...definition,
          literal: node.dataset.emojiLiteral === "true",
          shortcode: node.dataset.emojiShortcode ?? emojiShortcode(name),
        };
      },
    },
    {
      tag: "img.emoji[alt]",
      priority: 100,
      getAttrs: emojiAttrsFromGitHubDOM,
    },
    {
      tag: "g-emoji[alias]",
      getAttrs: emojiAttrsFromGitHubDOM,
    },
  ],
  toDOM: (node) => {
    const { emoji, imageUrl, literal, name, shortcode } = node.attrs;
    const commonAttrs = {
      "data-gfmd-emoji-shortcode": "",
      "data-emoji-name": name,
      "data-emoji-literal": String(literal),
      "data-emoji-shortcode": shortcode,
      contenteditable: "false",
    };

    if (literal) {
      return [
        "span",
        {
          ...commonAttrs,
          class: "gfmd-emoji-literal",
        },
        String(shortcode).replace(/^\\/, ""),
      ];
    }

    if (typeof imageUrl === "string" && imageUrl) {
      return [
        "img",
        {
          ...commonAttrs,
          align: "absmiddle",
          alt: shortcode,
          class: "emoji gfmd-emoji-image",
          height: "20",
          src: imageUrl,
          title: shortcode,
          width: "20",
        },
      ];
    }

    return [
      "span",
      {
        ...commonAttrs,
        "aria-label": shortcode,
        class: "gfmd-emoji-unicode",
        role: "img",
        title: shortcode,
      },
      String(emoji),
    ];
  },
};

function emojiAttrsFromGitHubDOM(node: Node | string) {
  if (!(node instanceof HTMLElement)) return false;
  const alias =
    node.getAttribute("alias") ??
    node.getAttribute("alt")?.match(/^:([+\-\w]+):$/)?.[1];
  if (!alias) return false;
  const definition = emojiDefinition(alias);
  return definition
    ? { ...definition, literal: false, shortcode: emojiShortcode(alias) }
    : false;
}
