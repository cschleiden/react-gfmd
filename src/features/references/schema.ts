import type { NodeSpec } from "prosemirror-model";

export const referenceNodeSpec: NodeSpec = {
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  attrs: {
    owner: { default: null },
    repo: { default: null },
    number: {},
    raw: {},
  },
  toDOM: (node) => [
    "span",
    {
      "data-gfmd-reference": node.attrs.raw,
      "data-owner": node.attrs.owner,
      "data-repo": node.attrs.repo,
      "data-number": String(node.attrs.number),
      class: "gfmd-reference",
    },
    node.attrs.raw,
  ],
  parseDOM: [
    {
      tag: "span[data-gfmd-reference]",
      getAttrs: (node) => {
        if (!(node instanceof HTMLElement)) return false;
        return {
          owner: node.getAttribute("data-owner"),
          repo: node.getAttribute("data-repo"),
          number: Number(node.getAttribute("data-number")),
          raw: node.getAttribute("data-gfmd-reference"),
        };
      },
    },
  ],
};
