import { type NodeSpec, Schema } from "prosemirror-model";
import { schema as basicSchema } from "prosemirror-schema-basic";
import { tableNodes } from "prosemirror-tables";
import {
  detailsNodeSpec,
  detailsSummaryNodeSpec,
} from "./features/details/schema";
import {
  bulletListNodeSpec,
  listItemNodeSpec,
  orderedListNodeSpec,
  taskListItemNodeSpec,
} from "./lists/schema";
import { isSafeInteractionHref } from "./link-url";

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
      details: detailsNodeSpec,
      details_summary: detailsSummaryNodeSpec,
      empty_link: {
        inline: true,
        group: "inline",
        atom: true,
        selectable: true,
        attrs: {
          href: { validate: "string" },
          title: { default: null, validate: "string|null" },
        },
        parseDOM: [
          {
            tag: "a[data-gfmd-empty-link]",
            priority: 60,
            getAttrs: (node) => {
              if (!(node instanceof HTMLElement)) return false;
              return {
                href: node.getAttribute("data-href") ?? "",
                title:
                  node.getAttribute("data-title") ??
                  node.getAttribute("title"),
              };
            },
          },
        ],
        toDOM: (node) => [
          "a",
          {
            "aria-label": `Empty link to ${node.attrs.href}`,
            "data-gfmd-empty-link": "",
            "data-href": node.attrs.href,
            href: isSafeInteractionHref(node.attrs.href)
              ? node.attrs.href
              : undefined,
            title: node.attrs.title,
          },
          "\u200b",
        ],
      },
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
            priority: 100,
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
            "aria-label": `Footnote ${node.attrs.label ?? node.attrs.identifier}`,
          },
          `[^${node.attrs.label ?? node.attrs.identifier}]`,
        ],
      },
      raw_block: rawMarkdownNodeSpec(false),
      raw_inline: rawMarkdownNodeSpec(true),
      task_list_item: taskListItemNodeSpec,
    })
    .append(tableNodeSpecs),
  marks: basicSchema.spec.marks
    .update("link", {
      ...basicSchema.spec.marks.get("link"),
      parseDOM: [
        {
          tag: "a[data-gfmd-link]",
          getAttrs: (node) => {
            if (!(node instanceof HTMLElement)) return false;
            return {
              href:
                node.getAttribute("data-href") ??
                node.getAttribute("href") ??
                "",
              title: node.getAttribute("title"),
            };
          },
        },
        {
          tag: "a[href]",
          getAttrs: (node) => {
            if (!(node instanceof HTMLElement)) return false;
            return {
              href: node.getAttribute("href") ?? "",
              title: node.getAttribute("title"),
            };
          },
        },
      ],
      toDOM: (mark) => [
        "a",
        {
          "data-gfmd-link": "",
          "data-href": mark.attrs.href,
          href: isSafeInteractionHref(mark.attrs.href)
            ? mark.attrs.href
            : undefined,
          title: mark.attrs.title,
        },
        0,
      ],
    })
    .append({
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

function rawMarkdownNodeSpec(inline: boolean): NodeSpec {
  const tag = inline ? "code" : "pre";
  const marker = inline ? "data-gfmd-raw-inline" : "data-gfmd-raw-block";

  return {
    atom: true,
    group: inline ? "inline" : "block",
    inline,
    selectable: true,
    attrs: {
      value: { default: "" },
    },
    parseDOM: [
      {
        tag: `${tag}[${marker}]`,
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          return { value: node.getAttribute("data-source") ?? node.textContent };
        },
      },
    ],
    toDOM: (node) => [
      tag,
      {
        [marker]: "",
        "data-source": node.attrs.value,
        contenteditable: "false",
        "aria-label": "Unsupported Markdown source",
      },
      node.attrs.value,
    ],
  };
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
        priority: 100,
        getAttrs: (node) => nodeAttrs(node, "data-identifier", "data-label"),
      },
    ],
    toDOM: (node) => [
      tag,
      {
        [markerAttr]: "",
        "data-identifier": node.attrs.identifier,
        "data-label": node.attrs.label,
        "aria-label": `Footnote ${node.attrs.label ?? node.attrs.identifier} definition`,
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
