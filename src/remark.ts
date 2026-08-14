import {
  fromPmMark,
  fromPmNode,
  fromProseMirror,
  remarkProseMirror,
  toPmMark,
  toPmNode,
  type FromProseMirrorOptions,
  type RemarkProseMirrorOptions,
} from "@handlewithcare/remark-prosemirror";
import type {
  Blockquote,
  Code,
  FootnoteReference,
  Html,
  Image,
  ImageReference,
  InlineCode,
  List,
  ListItem,
  Nodes as MdastNode,
  Parent as MdastParent,
  PhrasingContent,
  Root,
  Table,
  TableCell,
  TableRow,
  Text,
} from "mdast";
import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";

import {
  createRemarkDetails,
  detailsToMdast,
  parseDetails,
  parseDetailsSummary,
} from "./features/details";
import {
  isPhrasingContent,
  type FromProseMirrorState,
  type HandlerState,
} from "./mdast-utils";
import { gfmSchema } from "./schema";

const subscriptInlineTokenPattern = /@@GFMD_SUB\((.*?)\)@@/;
const superscriptInlineTokenPattern = /@@GFMD_SUP\((.*?)\)@@/;
const inlineTokenPattern = new RegExp(
  `${subscriptInlineTokenPattern.source}|${superscriptInlineTokenPattern.source}`,
  "g",
);
const markdownHandlers = {
  paragraph: toPmNode(gfmSchema.nodes.paragraph),
  heading: toPmNode(gfmSchema.nodes.heading, (node) => ({ level: node.depth })),
  blockquote: parseBlockquote,
  details: parseDetails,
  detailsSummary: parseDetailsSummary,
  list: parseList,
  listItem: (node: ListItem, _parent, state) =>
    (node.checked === null || node.checked === undefined
      ? gfmSchema.nodes.list_item
      : gfmSchema.nodes.task_list_item
    ).createAndFill(
      { checked: node.checked ?? false, spread: node.spread ?? false },
      state.all(node),
    ),
  code: (node: Code) =>
    gfmSchema.nodes.code_block.create(
      { language: node.lang ?? null, meta: node.meta ?? null },
      node.value ? gfmSchema.text(node.value) : undefined,
    ),
  thematicBreak: () => gfmSchema.nodes.horizontal_rule.create(),
  break: () => gfmSchema.nodes.hard_break.create(),
  text: (node: Text) => parseInlineText(node.value.replace(/\n/g, " ")),
  inlineCode: parseInlineCode,
  image: imageNode,
  imageReference: parseImageReference,
  html: parseHtml,
  emphasis: toPmMark(gfmSchema.marks.em),
  strong: toPmMark(gfmSchema.marks.strong),
  delete: toPmMark(gfmSchema.marks.strike),
  link: toPmMark(gfmSchema.marks.link, (node) => ({
    href: node.url,
    title: node.title ?? null,
  })),
  footnoteReference: (node: FootnoteReference) =>
    gfmSchema.nodes.footnote_reference.create({
      identifier: node.identifier,
      label: node.label ?? node.identifier,
    }),
  footnoteDefinition: toPmNode(gfmSchema.nodes.footnote_definition, (node) => ({
    identifier: node.identifier,
    label: node.label ?? node.identifier,
  })),
  table: parseTable,
} satisfies RemarkProseMirrorOptions["handlers"];

const markdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(createRemarkDetails(parseSummaryMarkdown))
  .use(remarkProseMirror, {
    schema: gfmSchema,
    handlers: markdownHandlers,
  });

const markdownStringifier = unified().use(remarkGfm).use(remarkStringify, {
  bullet: "-",
  emphasis: "*",
  fences: true,
  listItemIndent: "one",
  rule: "-",
  strong: "*",
});

const proseMirrorNodeHandlers: FromProseMirrorOptions<
  string,
  string
>["nodeHandlers"] = {
  paragraph: fromPmNode("paragraph"),
  heading: fromPmNode("heading", (node) => ({ depth: node.attrs.level })),
  blockquote: fromPmNode("blockquote"),
  bullet_list: (node, _parent, state) =>
    ({
      type: "list",
      ordered: false,
      spread: !node.attrs.tight,
      children: state.all(node),
    }) as List,
  ordered_list: (node, _parent, state) =>
    ({
      type: "list",
      ordered: true,
      start: node.attrs.order,
      spread: !node.attrs.tight,
      children: state.all(node),
    }) as List,
  list_item: fromPmNode("listItem", (node) => ({
    checked: null,
    spread: node.attrs.spread,
  })),
  task_list_item: fromPmNode("listItem", (node) => ({
    checked: node.attrs.checked,
    spread: node.attrs.spread,
  })),
  code_block: (node) => ({
    type: "code",
    lang: node.attrs.language,
    meta: node.attrs.meta,
    value: node.textContent,
  }),
  horizontal_rule: () => ({ type: "thematicBreak" }),
  hard_break: () => ({ type: "break" }),
  image: (node) => ({
    type: "image",
    url: node.attrs.src,
    alt: node.attrs.alt ?? "",
    title: node.attrs.title ?? null,
  }),
  footnote_reference: (node) => ({
    type: "footnoteReference",
    identifier: node.attrs.identifier,
    label: node.attrs.label ?? node.attrs.identifier,
  }),
  footnote_definition: fromPmNode("footnoteDefinition", (node) => ({
    identifier: node.attrs.identifier,
    label: node.attrs.label ?? node.attrs.identifier,
  })),
  details: (node, parent, state) =>
    detailsToMdast(node, parent, state, stringifyMarkdownTree),
  details_summary: () => null,
  table: (node, _parent, state) =>
    ({
      type: "table",
      align: tableAlign(node),
      children: state.all(node),
    }) as Table,
  table_row: (node, _parent, state) =>
    ({
      type: "tableRow",
      children: state.all(node),
    }) as TableRow,
  table_cell: tableCellToMdast,
  table_header: tableCellToMdast,
};

const proseMirrorMarkHandlers: FromProseMirrorOptions<
  string,
  string
>["markHandlers"] = {
  strong: fromPmMark("strong"),
  em: fromPmMark("emphasis"),
  strike: fromPmMark("delete"),
  subscript: (_mark, _parent, children) =>
    ({
      type: "html",
      value: `<sub>${escapeHtml(mdastInlineText(children))}</sub>`,
    }) as Html,
  superscript: (_mark, _parent, children) =>
    ({
      type: "html",
      value: `<sup>${escapeHtml(mdastInlineText(children))}</sup>`,
    }) as Html,
  code: (_mark, _parent, children) => ({
    type: "inlineCode",
    value: mdastInlineText(children),
  }),
  link: fromPmMark("link", (mark: Mark) => ({
    url: mark.attrs.href,
    title: mark.attrs.title,
  })),
};

const summaryParser = unified().use(remarkParse).use(remarkGfm);

export function parseWithRemark(markdown: string) {
  const normalizedMarkdown = markdown.replace(/\r\n?/g, "\n");
  return markdownParser.processSync(encodeInlineHtmlMarks(normalizedMarkdown))
    .result as ProseMirrorNode;
}

export function serializeWithRemark(doc: ProseMirrorNode) {
  const tree = fromProseMirror(doc, {
    schema: gfmSchema,
    nodeHandlers: proseMirrorNodeHandlers,
    markHandlers: proseMirrorMarkHandlers,
  });

  return stringifyMarkdownTree(tree).trimEnd();
}

function stringifyMarkdownTree(tree: Root) {
  return restoreEscapedCustomTokens(markdownStringifier.stringify(tree));
}

export function parseInlineText(text: string): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(inlineTokenPattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      nodes.push(gfmSchema.text(text.slice(lastIndex, match.index)));
    }

    const parsed = parseInlineStyleToken(match[0]);
    nodes.push(parsed ?? gfmSchema.text(match[0]));

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(gfmSchema.text(text.slice(lastIndex)));
  }

  return nodes;
}

function parseInlineCode(node: InlineCode) {
  const value = node.value;
  if (!value) return [];

  return gfmSchema.text(value, [gfmSchema.marks.code.create()]);
}

function imageNode(node: Pick<Image, "alt" | "title" | "url">) {
  return gfmSchema.nodes.image.create({
    src: node.url,
    alt: node.alt ?? null,
    title: node.title ?? null,
  });
}

function parseImageReference(
  node: ImageReference,
  _parent: MdastParent,
  state: HandlerState,
) {
  const definition = state.definitionById?.get(
    String(node.identifier).toUpperCase(),
  );

  if (!definition) {
    return gfmSchema.text(imageReferenceMarkdown(node));
  }

  return imageNode({
    alt: node.alt ?? null,
    title: definition.title ?? null,
    url: definition.url,
  });
}

function imageReferenceMarkdown(node: ImageReference) {
  const label = node.label || node.identifier;
  if (node.referenceType === "shortcut") return `![${node.alt ?? ""}]`;
  if (node.referenceType === "collapsed") return `![${node.alt ?? ""}][]`;
  return `![${node.alt ?? ""}][${label}]`;
}

function parseHtml(node: Html, parent: MdastParent | undefined) {
  const image = htmlImageNode(node.value);
  if (!image) {
    const text = gfmSchema.text(node.value);
    return parent?.type === "paragraph"
      ? text
      : gfmSchema.nodes.paragraph.create(null, text);
  }

  return parent?.type === "paragraph"
    ? image
    : gfmSchema.nodes.paragraph.create(null, image);
}

function htmlImageNode(html: string) {
  const trimmed = html.trim();
  if (!/^<img[\s>/]/i.test(trimmed)) return null;

  return imageNode({
    alt: htmlAttribute(trimmed, "alt"),
    title: htmlAttribute(trimmed, "title"),
    url: htmlAttribute(trimmed, "src") ?? "",
  });
}

function htmlAttribute(html: string, name: string) {
  const match = html.match(
    new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );

  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function parseBlockquote(
  node: Blockquote,
  _parent: MdastParent,
  state: HandlerState,
) {
  return gfmSchema.nodes.blockquote.createAndFill(null, state.all(node));
}

function parseList(node: List, _parent: MdastParent, state: HandlerState) {
  const type = node.ordered
    ? gfmSchema.nodes.ordered_list
    : gfmSchema.nodes.bullet_list;

  return type.createChecked(
    node.ordered
      ? {
          order: node.start ?? 1,
          tight: !node.spread,
        }
      : {
          tight: !node.spread,
        },
    state.all(node),
  );
}

function parseTable(node: Table, _parent: MdastParent, state: HandlerState) {
  return gfmSchema.nodes.table.createChecked(
    null,
    node.children.map((row, rowIndex) =>
      parseTableRow(row, node.align ?? [], rowIndex === 0, state),
    ),
  );
}

function parseTableRow(
  node: TableRow,
  align: Table["align"],
  header: boolean,
  state: HandlerState,
) {
  return gfmSchema.nodes.table_row.createChecked(
    null,
    node.children.map((cell, column) =>
      parseTableCell(cell, align?.[column] ?? null, header, state),
    ),
  );
}

function parseTableCell(
  node: TableCell,
  align: string | null,
  header: boolean,
  state: HandlerState,
) {
  const type = header ? gfmSchema.nodes.table_header : gfmSchema.nodes.table_cell;
  const paragraph = gfmSchema.nodes.paragraph.create(null, state.all(node));

  const cell = type.createAndFill({ align }, paragraph);
  if (!cell) {
    throw new Error("Could not create table cell from Markdown table.");
  }

  return cell;
}

function tableAlign(node: ProseMirrorNode) {
  const firstRow = node.firstChild;
  if (!firstRow) return [];

  const align: Array<string | null> = [];
  firstRow.forEach((cell) => {
    align.push(typeof cell.attrs.align === "string" ? cell.attrs.align : null);
  });

  return align;
}

function tableCellToMdast(
  node: ProseMirrorNode,
  _parent: ProseMirrorNode | undefined,
  state: FromProseMirrorState,
) {
  return {
    type: "tableCell",
    children: tableCellChildren(node, state),
  } as TableCell;
}

function tableCellChildren(
  node: ProseMirrorNode,
  state: FromProseMirrorState,
): PhrasingContent[] {
  return state
    .all(node)
    .flatMap((child): PhrasingContent[] => {
      if (child.type === "paragraph" && "children" in child) {
        return child.children as PhrasingContent[];
      }

      if (isPhrasingContent(child)) return [child];
      if ("value" in child && typeof child.value === "string") {
        return [{ type: "text", value: child.value }];
      }

      return [{ type: "text", value: "" }];
    });
}

function parseSummaryMarkdown(value: string): PhrasingContent[] {
  const tree = summaryParser.parse(encodeInlineHtmlMarks(value.trim()));
  const firstChild = tree.children[0];

  if (firstChild?.type === "paragraph") {
    return firstChild.children;
  }

  return value.trim() ? [{ type: "text", value: value.trim() }] : [];
}

function mdastInlineText(nodes: MdastNode[]): string {
  return nodes
    .map((node) => {
      if ("value" in node && typeof node.value === "string") return node.value;
      return "";
    })
    .join("");
}

function parseInlineStyleToken(token: string) {
  const subMatch = token.match(subscriptInlineTokenPattern);
  if (subMatch?.[1]) {
    return gfmSchema.text(decodeInlineStylePayload(subMatch[1]), [
      gfmSchema.marks.subscript.create(),
    ]);
  }

  const supMatch = token.match(superscriptInlineTokenPattern);
  if (supMatch?.[1]) {
    return gfmSchema.text(decodeInlineStylePayload(supMatch[1]), [
      gfmSchema.marks.superscript.create(),
    ]);
  }

  return undefined;
}

function encodeInlineHtmlMarks(markdown: string) {
  return markdown
    .replace(
      /<sub>([\s\S]*?)<\/sub>/gi,
      (_match, value: string) =>
        `@@GFMD_SUB(${encodeInlineStylePayload(value)})@@`,
    )
    .replace(
      /<sup>([\s\S]*?)<\/sup>/gi,
      (_match, value: string) =>
        `@@GFMD_SUP(${encodeInlineStylePayload(value)})@@`,
    );
}

function encodeInlineStylePayload(value: string) {
  return encodeURIComponent(value);
}

function decodeInlineStylePayload(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function restoreEscapedCustomTokens(markdown: string) {
  return markdown.replace(/\\#(?=\d)/g, "#");
}
