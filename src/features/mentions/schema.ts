import type { NodeSpec } from "prosemirror-model";

export const mentionNodeSpec: NodeSpec = {
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  attrs: {
    username: {},
  },
  toDOM: (node) => [
    "span",
    {
      "data-gfmd-mention": node.attrs.username,
      class: "gfmd-mention",
    },
    `@${node.attrs.username}`,
  ],
  parseDOM: [
    {
      tag: "span[data-gfmd-mention]",
      getAttrs: (node) => {
        if (!(node instanceof HTMLElement)) return false;
        return { username: node.getAttribute("data-gfmd-mention") };
      },
    },
  ],
};
