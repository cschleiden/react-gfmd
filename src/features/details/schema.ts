import type { NodeSpec } from "prosemirror-model";

export const detailsNodeSpec: NodeSpec = {
  attrs: {
    open: { default: false },
    implicitSummary: { default: false },
  },
  content: "details_summary block*",
  group: "block",
  defining: true,
  parseDOM: [
    {
      tag: "details",
      getAttrs: (node) => ({
        open: node instanceof HTMLDetailsElement ? node.open : false,
        implicitSummary: false,
      }),
    },
  ],
  toDOM: (node) => [
    "details",
    {
      "data-gfmd-details": "",
      ...(node.attrs.open ? { open: "open" } : {}),
    },
    0,
  ],
};

export const detailsSummaryNodeSpec: NodeSpec = {
  content: "inline*",
  defining: true,
  parseDOM: [{ tag: "summary" }],
  toDOM: () => ["summary", { "data-gfmd-details-summary": "" }, 0],
};
