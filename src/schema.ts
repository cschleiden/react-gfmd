import { Schema } from "prosemirror-model";
import { alertNodeSpec } from "./features/alerts";
import { mentionNodeSpec } from "./features/mentions";
import { referenceNodeSpec } from "./features/references";

export const gfmSchema = new Schema({
  nodes: {
    doc: {
      content: "block+",
    },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    alert: alertNodeSpec,
    reference: referenceNodeSpec,
    mention: mentionNodeSpec,
    text: {
      group: "inline",
    },
  },
  marks: {
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0],
    },
    em: {
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM: () => ["em", 0],
    },
    code: {
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0],
    },
    link: {
      attrs: {
        href: {},
        title: { default: null },
      },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[href]",
          getAttrs: (node) => {
            if (!(node instanceof HTMLElement)) return false;
            return {
              href: node.getAttribute("href"),
              title: node.getAttribute("title"),
            };
          },
        },
      ],
      toDOM: (node) => [
        "a",
        {
          href: node.attrs.href,
          title: node.attrs.title,
        },
        0,
      ],
    },
  },
});
