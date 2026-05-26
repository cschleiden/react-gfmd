import {
  fromProseMirror,
  fromPmMark,
  fromPmNode,
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
  InlineCode,
  List,
  ListItem,
  Nodes as MdastNode,
  Parent as MdastParent,
  Text,
} from "mdast";
import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { alertKinds } from "../features/alerts";
import { mentionTokenPattern, parseMentionToken, serializeMentionNode } from "../features/mentions";
import { parseReferenceToken, referenceTokenPattern, serializeReferenceNode } from "../features/references";
import { gfmSchema } from "../schema";

const inlineTokenPattern = new RegExp(`${referenceTokenPattern.source}|${mentionTokenPattern.source}`, "g");
const alertMarkerPattern = new RegExp(`^\\[!(${alertKinds.join("|")})\\](?:\\s+|\\n|$)`, "i");

const markdownHandlers = {
  paragraph: toPmNode(gfmSchema.nodes.paragraph),
  heading: toPmNode(gfmSchema.nodes.heading, (node) => ({ level: node.depth })),
  blockquote: parseBlockquote,
  list: parseList,
  listItem: toPmNode(gfmSchema.nodes.list_item, (node: ListItem) => ({
    checked: node.checked ?? null,
    spread: node.spread ?? false,
  })),
  code: (node: Code) =>
    gfmSchema.nodes.code_block.create(
      { language: node.lang ?? null, meta: node.meta ?? null },
      node.value ? gfmSchema.text(node.value) : undefined,
    ),
  thematicBreak: () => gfmSchema.nodes.horizontal_rule.create(),
  break: () => gfmSchema.nodes.hard_break.create(),
  inlineCode: (node: InlineCode) => gfmSchema.text(node.value, [gfmSchema.marks.code.create()]),
  text: (node: Text) => parseInlineText(node.value.replace(/\n/g, " ")),
  emphasis: toPmMark(gfmSchema.marks.em),
  strong: toPmMark(gfmSchema.marks.strong),
  delete: toPmMark(gfmSchema.marks.strike),
  link: toPmMark(gfmSchema.marks.link, (node) => ({ href: node.url, title: node.title ?? null })),
  footnoteReference: (node: FootnoteReference) =>
    gfmSchema.nodes.footnote_reference.create({
      identifier: node.identifier,
      label: node.label ?? node.identifier,
    }),
  footnoteDefinition: toPmNode(gfmSchema.nodes.footnote_definition, (node) => ({
    identifier: node.identifier,
    label: node.label ?? node.identifier,
  })),
  table: unsupportedGfmNode("tables"),
  tableRow: unsupportedGfmNode("tables"),
  tableCell: unsupportedGfmNode("tables"),
} satisfies RemarkProseMirrorOptions["handlers"];

const markdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
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

const proseMirrorNodeHandlers: FromProseMirrorOptions<string, string>["nodeHandlers"] = {
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
  reference: (node) => ({ type: "text", value: serializeReferenceNode(node) }),
  mention: (node) => ({ type: "text", value: serializeMentionNode(node) }),
  footnote_reference: (node) => ({
    type: "footnoteReference",
    identifier: node.attrs.identifier,
    label: node.attrs.label ?? node.attrs.identifier,
  }),
  footnote_definition: fromPmNode("footnoteDefinition", (node) => ({
    identifier: node.attrs.identifier,
    label: node.attrs.label ?? node.attrs.identifier,
  })),
};

const proseMirrorMarkHandlers: FromProseMirrorOptions<string, string>["markHandlers"] = {
  strong: fromPmMark("strong"),
  em: fromPmMark("emphasis"),
  strike: fromPmMark("delete"),
  code: (_mark, _parent, children) => ({
    type: "inlineCode",
    value: mdastInlineText(children),
  }),
  link: fromPmMark("link", (mark: Mark) => ({
    url: mark.attrs.href,
    title: mark.attrs.title,
  })),
};

export function parseWithRemark(markdown: string) {
  return markdownParser.processSync(markdown.replace(/\r\n?/g, "\n")).result as ProseMirrorNode;
}

export function serializeWithRemark(doc: ProseMirrorNode) {
  const tree = fromProseMirror(doc, {
    schema: gfmSchema,
    nodeHandlers: proseMirrorNodeHandlers,
    markHandlers: proseMirrorMarkHandlers,
  });

  const markdown = markdownStringifier.stringify(tree).trimEnd();

  return restoreEscapedCustomTokens(markdown);
}

export function parseInlineText(text: string): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(inlineTokenPattern)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      nodes.push(gfmSchema.text(text.slice(lastIndex, match.index)));
    }

    const parsed = parseReferenceToken(gfmSchema, match[0]) ?? parseMentionToken(gfmSchema, match[0]);
    nodes.push(parsed ?? gfmSchema.text(match[0]));

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(gfmSchema.text(text.slice(lastIndex)));
  }

  return nodes;
}

function parseBlockquote(node: Blockquote, _parent: MdastParent, state: HandlerState) {
  const alert = extractAlert(node);
  if (alert) {
    const children = alert.children.flatMap((child) => asArray(state.one(child, node)));
    return gfmSchema.nodes.alert.createAndFill({ kind: alert.kind }, children);
  }

  return gfmSchema.nodes.blockquote.createAndFill(null, state.all(node));
}

function parseList(node: List, _parent: MdastParent, state: HandlerState) {
  const type = node.ordered ? gfmSchema.nodes.ordered_list : gfmSchema.nodes.bullet_list;
  return type.createAndFill(
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

function extractAlert(node: Blockquote): { kind: string; children: MdastNode[] } | undefined {
  const first = node.children[0];
  if (first?.type !== "paragraph") return undefined;
  const firstChild = first.children[0];
  if (firstChild?.type !== "text") return undefined;

  const match = firstChild.value.match(alertMarkerPattern);
  if (!match) return undefined;

  const remaining = firstChild.value.slice(match[0].length).replace(/^\s+/, "");
  const children = [...first.children];

  if (remaining) {
    children[0] = { ...firstChild, value: remaining };
  } else {
    children.shift();
  }

  return {
    kind: match[1].toUpperCase(),
    children: children.length ? [{ ...first, children }, ...node.children.slice(1)] : node.children.slice(1),
  };
}

function unsupportedGfmNode(feature: string) {
  return () => {
    throw new Error(`GFM ${feature} are parsed but not mapped to the ProseMirror schema yet.`);
  };
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function mdastInlineText(nodes: MdastNode[]): string {
  return nodes
    .map((node) => {
      if ("value" in node && typeof node.value === "string") return node.value;
      return "";
    })
    .join("");
}

function restoreEscapedCustomTokens(markdown: string) {
  return markdown.replace(/\\#(?=\d)/g, "#");
}

interface HandlerState {
  all: (node: MdastNode) => ProseMirrorNode[];
  one: (node: MdastNode, parent: MdastParent | undefined) => ProseMirrorNode | ProseMirrorNode[] | null;
}
