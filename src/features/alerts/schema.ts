import type { NodeSpec } from "prosemirror-model";

export const alertNodeSpec: NodeSpec = {
  content: "block+",
  group: "block",
  defining: true,
  attrs: {
    kind: { default: "NOTE" },
    title: { default: null },
  },
  parseDOM: [
    {
      tag: "div[data-gfmd-alert]",
      getAttrs: (node) => {
        if (!(node instanceof HTMLElement)) return false;
        return {
          kind: node.getAttribute("data-kind") ?? "NOTE",
          title: node.getAttribute("data-title"),
        };
      },
    },
  ],
  toDOM: (node) => [
    "div",
    {
      "data-gfmd-alert": "",
      "data-kind": node.attrs.kind,
      "data-title": node.attrs.title,
      class: `gfmd-alert gfmd-alert-${String(node.attrs.kind).toLowerCase()}`,
    },
    0,
  ],
};
