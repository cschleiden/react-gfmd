import { type NodeSpec, Schema } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { tableNodes } from "prosemirror-tables";
import {
  bulletListNodeSpec,
  listItemNodeSpec,
  orderedListNodeSpec,
  taskListItemNodeSpec,
} from "./lists/schema";

const baseNodes = basicSchema.spec.nodes;
const tableNodeSpecs = tableNodes({
  tableGroup: "block",
  cellContent: "paragraph",
  cellAttributes: {
    align: {
      default: null,
      getFromDOM: (dom) =>
        dom.style.textAlign || dom.getAttribute("align") || null,
      setDOMAttr: (value, attrs) => {
        if (typeof value === "string" && value) {
          attrs.style = `text-align: ${value}`;
        }
      },
    },
  },
});

export const gfmSchema = new Schema({
  nodes: baseNodes
    .append({
      ordered_list: orderedListNodeSpec,
      bullet_list: bulletListNodeSpec,
      list_item: listItemNodeSpec,
    })
    .update("code_block", {
      ...baseNodes.get("code_block"),
      attrs: {
        language: { default: null },
        meta: { default: null },
      },
      toDOM: (node) => [
        "pre",
        [
          "code",
          {
            "data-language": node.attrs.language,
            "data-meta": node.attrs.meta,
          },
          0,
        ],
      ],
    })
    .append({
      footnote_definition: blockContainerNode(
        "section",
        "data-gfmd-footnote-definition",
      ),
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
            getAttrs: (node) =>
              nodeAttrs(node, "data-identifier", "data-label"),
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
      task_list_item: taskListItemNodeSpec,
    })
    .append(tableNodeSpecs),
  marks: basicSchema.spec.marks.append({
    strike: {
      parseDOM: [{ tag: "s" }, { tag: "del" }],
      toDOM: () => ["del", 0],
    },
    subscript: {
      excludes: "superscript",
      parseDOM: [{ tag: "sub" }],
      toDOM: () => ["sub", 0],
    },
    superscript: {
      excludes: "subscript",
      parseDOM: [{ tag: "sup" }],
      toDOM: () => ["sup", 0],
    },
  }),
});

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

function nodeAttrs(
  node: Node | string,
  identifierAttr: string,
  labelAttr: string,
) {
  if (!(node instanceof HTMLElement)) return false;
  return {
    identifier: node.getAttribute(identifierAttr),
    label: node.getAttribute(labelAttr),
  };
}
