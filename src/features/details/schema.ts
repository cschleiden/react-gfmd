import type { NodeSpec } from "prosemirror-model";

export const detailsNodeSpec: NodeSpec = {
  attrs: {
    open: { default: false },
    implicitSummary: { default: false },
  },
  content: "details_summary block+",
  group: "block",
  defining: true,
  parseDOM: [
    {
      tag: "details",
      getAttrs: (node) => ({
        open: node instanceof HTMLDetailsElement ? node.open : false,
        implicitSummary:
          node instanceof HTMLElement &&
          node.getAttribute("data-gfmd-implicit-summary") === "true",
      }),
    },
  ],
  toDOM: (node) => [
    "details",
    {
      "data-gfmd-details": "",
      "data-gfmd-implicit-summary": String(node.attrs.implicitSummary),
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
