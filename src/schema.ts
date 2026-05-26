import type { NodeSpec } from "prosemirror-model";
import { Schema } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { alertNodeSpec } from "./features/alerts";
import { mentionNodeSpec } from "./features/mentions";
import { referenceNodeSpec } from "./features/references";

const listNodes = addListNodes(basicSchema.spec.nodes.remove("image"), "paragraph block*", "block");
const bulletListSpec = listNodes.get("bullet_list")!;
const orderedListSpec = listNodes.get("ordered_list")!;

export const gfmSchema = new Schema({
  nodes: listNodes
    .update("bullet_list", withAttrs(bulletListSpec, { tight: { default: true } }))
    .update(
      "ordered_list",
      withAttrs(orderedListSpec, { order: { default: 1 }, tight: { default: true } }),
    )
    .update("list_item", {
      ...listNodes.get("list_item"),
      attrs: {
        checked: { default: null },
        spread: { default: false },
      },
      parseDOM: [
        {
          tag: "li",
          getAttrs: (node) => {
            if (!(node instanceof HTMLElement)) return false;
            const checked = node.getAttribute("data-checked");
            return { checked: checked === null ? null : checked === "true" };
          },
        },
      ],
      toDOM: (node) => ["li", { "data-checked": node.attrs.checked }, 0],
    })
    .update("code_block", {
      ...listNodes.get("code_block"),
      attrs: {
        language: { default: null },
        meta: { default: null },
      },
      toDOM: (node) => [
        "pre",
        ["code", { "data-language": node.attrs.language, "data-meta": node.attrs.meta }, 0],
      ],
    })
    .append({
      alert: alertNodeSpec,
      footnote_definition: blockContainerNode("section", "data-gfmd-footnote-definition"),
      reference: referenceNodeSpec,
      mention: mentionNodeSpec,
      footnote_reference: {
        inline: true,
        group: "inline",
        atom: true,
        selectable: true,
        attrs: {
          identifier: {},
          label: { default: null },
        },
        parseDOM: [
          {
            tag: "sup[data-gfmd-footnote-reference]",
            getAttrs: (node) => nodeAttrs(node, "data-identifier", "data-label"),
          },
        ],
        toDOM: (node) => [
          "sup",
          {
            "data-gfmd-footnote-reference": "",
            "data-identifier": node.attrs.identifier,
            "data-label": node.attrs.label,
          },
          `[^${node.attrs.label ?? node.attrs.identifier}]`,
        ],
      },
    }),
  marks: basicSchema.spec.marks.append({
    strike: {
      parseDOM: [{ tag: "s" }, { tag: "del" }],
      toDOM: () => ["del", 0],
    },
  }),
});

function withAttrs(spec: NodeSpec, attrs: NodeSpec["attrs"]): NodeSpec {
  return { ...spec, attrs: { ...spec.attrs, ...attrs } };
}

function blockContainerNode(tag: string, markerAttr: string): NodeSpec {
  return {
    content: "block+",
    group: "block",
    defining: true,
    attrs: {
      identifier: {},
      label: { default: null },
    },
    parseDOM: [
      {
        tag: `${tag}[${markerAttr}]`,
        getAttrs: (node) => nodeAttrs(node, "data-identifier", "data-label"),
      },
    ],
    toDOM: (node) => [
      tag,
      {
        [markerAttr]: "",
        "data-identifier": node.attrs.identifier,
        "data-label": node.attrs.label,
      },
      0,
    ],
  };
}

function nodeAttrs(node: Node | string, identifierAttr: string, labelAttr: string) {
  if (!(node instanceof HTMLElement)) return false;
  return {
    identifier: node.getAttribute(identifierAttr),
    label: node.getAttribute(labelAttr),
  };
}
