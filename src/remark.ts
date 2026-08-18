import {
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
  Html,
  Image,
  ImageReference,
  InlineCode,
  Link,
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
  alertToMdast,
  createRemarkGitHubAlerts,
  parseAlert,
} from "./features/alerts/markdown";
import {
  createRemarkDetails,
  detailsToMdast,
  parseDetails,
  parseDetailsSummary,
} from "./features/details";
import {
  createRemarkEmojiShortcodes,
  emojiShortcodeToMdast,
  parseEmojiShortcode,
} from "./features/emoji";
import {
  createRemarkGitHubHtml,
  definitionListToMdast,
  parseDefinitionDescription,
  parseDefinitionList,
  parseDefinitionTerm,
  parsePicture,
  parseSafeHtmlContainer,
  parseSafeHtmlInline,
  pictureToMdast,
  safeHtmlContainerToMdast,
  safeHtmlMarkToMdast,
} from "./features/html";
import {
  createRemarkGitHubReferences,
  parseGitHubMention,
  parseGitHubReference,
  projectTokenToMdast,
} from "./features/references";
import {
  isPhrasingContent,
  type FromProseMirrorState,
  type HandlerState,
} from "./mdast-utils";
import { fromProseMirrorStable } from "./from-prosemirror";
import {
  createRemarkRawHtmlRegions,
  isStandaloneHtmlElement,
} from "./raw-html-regions";
import { gfmSchema } from "./schema";
import type { EditorContext } from "./types";

const subscriptInlineTokenPattern = /@@GFMD_SUB\((.*?)\)@@/;
const superscriptInlineTokenPattern = /@@GFMD_SUP\((.*?)\)@@/;
const emptyTaskToken = "GFMD9EMPTYTASK9TOKEN";
const inlineTokenPattern = new RegExp(
  `${subscriptInlineTokenPattern.source}|${superscriptInlineTokenPattern.source}`,
  "g",
);
const markdownHandlers = {
  paragraph: toPmNode(gfmSchema.nodes.paragraph),
  heading: toPmNode(gfmSchema.nodes.heading, (node) => ({ level: node.depth })),
  blockquote: parseBlockquote,
  githubAlert: parseAlert,
  githubMention: parseGitHubMention,
  githubReference: parseGitHubReference,
  details: parseDetails,
  detailsSummary: parseDetailsSummary,
  emojiShortcode: parseEmojiShortcode,
  definitionDescription: parseDefinitionDescription,
  definitionList: parseDefinitionList,
  definitionTerm: parseDefinitionTerm,
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
  text: (node: Text) =>
    parseInlineText(
      node.value.replaceAll(emptyTaskToken, "").replace(/\n/g, " "),
    ),
  inlineCode: parseInlineCode,
  image: imageNode,
  imageReference: parseImageReference,
  html: parseHtml,
  emphasis: toPmMark(gfmSchema.marks.em),
  strong: toPmMark(gfmSchema.marks.strong),
  delete: toPmMark(gfmSchema.marks.strike),
  link: parseLink,
  footnoteReference: (node: FootnoteReference) =>
    gfmSchema.nodes.footnote_reference.create({
      identifier: node.identifier,
      label: node.label ?? node.identifier,
    }),
  footnoteDefinition: toPmNode(gfmSchema.nodes.footnote_definition, (node) => ({
    identifier: node.identifier,
    label: node.label ?? node.identifier,
  })),
  picture: parsePicture,
  safeHtmlContainer: parseSafeHtmlContainer,
  safeHtmlInline: parseSafeHtmlInline,
  table: parseTable,
} satisfies RemarkProseMirrorOptions["handlers"];

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
  alert: alertToMdast,
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
  list_item: listItemToMdast,
  task_list_item: taskListItemToMdast,
  code_block: (node) => ({
    type: "code",
    lang: node.attrs.language,
    meta: node.attrs.meta,
    value: node.textContent,
  }),
  horizontal_rule: () => ({ type: "thematicBreak" }),
  hard_break: () => ({ type: "break" }),
  empty_link: (node) => ({
    type: "link",
    url: node.attrs.href,
    title: node.attrs.title,
    children: [],
  }),
  raw_block: rawMarkdownToMdast,
  raw_inline: rawMarkdownToMdast,
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
  github_mention: projectTokenToMdast,
  github_reference: projectTokenToMdast,
  details: (node, parent, state) =>
    detailsToMdast(node, parent, state, stringifyMarkdownTree),
  details_summary: () => null,
  emoji_shortcode: emojiShortcodeToMdast,
  definition_description: () => null,
  definition_list: definitionListToMdast,
  definition_term: () => null,
  html_block_container: safeHtmlContainerToMdast,
  picture: pictureToMdast,
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
  highlight: (mark, _parent, children) =>
    safeHtmlMarkToMdast(mark, children),
  insert: (mark, _parent, children) =>
    safeHtmlMarkToMdast(mark, children),
  keyboard_input: (mark, _parent, children) =>
    safeHtmlMarkToMdast(mark, children),
  quote: (mark, _parent, children) =>
    safeHtmlMarkToMdast(mark, children),
  sample_output: (mark, _parent, children) =>
    safeHtmlMarkToMdast(mark, children),
  subscript: (mark, _parent, children) =>
    safeHtmlMarkToMdast(mark, children),
  superscript: (mark, _parent, children) =>
    safeHtmlMarkToMdast(mark, children),
  teletype: (mark, _parent, children) =>
    safeHtmlMarkToMdast(mark, children),
  variable: (mark, _parent, children) =>
    safeHtmlMarkToMdast(mark, children),
  code: (_mark, _parent, children) => ({
    type: "inlineCode",
    value: mdastInlineText(children),
  }),
  link: fromPmMark("link", (mark: Mark) => ({
    url: mark.attrs.href,
    title: mark.attrs.title,
  })),
};

export function parseWithRemark(markdown: string, context?: EditorContext) {
  const normalizedMarkdown = markdown.replace(/\r\n?/g, "\n");
  return createMarkdownParser(context).processSync(normalizedMarkdown)
    .result as ProseMirrorNode;
}

export function serializeWithRemark(doc: ProseMirrorNode) {
  const tree = fromProseMirrorStable(doc, {
    schema: gfmSchema,
    nodeHandlers: proseMirrorNodeHandlers,
    markHandlers: proseMirrorMarkHandlers,
  });

  return stringifyMarkdownTree(tree).trimEnd();
}

function createMarkdownParser(context?: EditorContext) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(createRemarkGitHubAlerts())
    .use(createRemarkGitHubReferences(context))
    .use(createRemarkEmojiShortcodes())
    .use(createRemarkEmptyTaskItems)
    .use(createRemarkDetails((value) => parseSummaryMarkdown(value, context)))
    .use(createRemarkGitHubHtml())
    .use(createRemarkRawHtmlRegions())
    .use(createRemarkInlineHtmlMarks)
    .use(remarkProseMirror, {
      schema: gfmSchema,
      handlers: markdownHandlers,
    });
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

function parseLink(
  node: Link,
  _parent: MdastParent,
  state: HandlerState,
) {
  const children = state.all(node);
  const attrs = { href: node.url, title: node.title ?? null };
  if (children.length === 0) {
    return gfmSchema.nodes.empty_link.create(attrs);
  }

  const mark = gfmSchema.marks.link.create(attrs);
  return children.map((child) =>
    child.isInline ? child.mark(mark.addToSet(child.marks)) : child,
  );
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
  const inline = isInlineHtmlParent(parent);
  if (!image) {
    const type = inline
      ? gfmSchema.nodes.raw_inline
      : gfmSchema.nodes.raw_block;
    const region = (
      node.data as
        | {
            gfmdRawHtmlRegion?: {
              tagName: string;
              malformed: boolean;
            };
          }
        | undefined
    )?.gfmdRawHtmlRegion;
    return type.create({
      value: node.value,
      kind: region ? "html_region" : "html",
      tagName: region?.tagName ?? null,
      malformed: region?.malformed ?? false,
    });
  }

  return inline
    ? image
    : gfmSchema.nodes.paragraph.create(null, image);
}

function isInlineHtmlParent(parent: MdastParent | undefined) {
  return Boolean(
    parent &&
      [
        "delete",
        "detailsSummary",
        "emphasis",
        "heading",
        "link",
        "paragraph",
        "safeHtmlInline",
        "strong",
        "tableCell",
      ].includes(parent.type),
  );
}

function htmlImageNode(html: string) {
  const trimmed = html.trim();
  if (!isStandaloneHtmlElement(trimmed, "img")) return null;
  const src = htmlAttribute(trimmed, "src");
  if (src === null) return null;

  return imageNode({
    alt: htmlAttribute(trimmed, "alt"),
    title: htmlAttribute(trimmed, "title"),
    url: src,
  });
}

function rawMarkdownToMdast(node: ProseMirrorNode): Html {
  return {
    type: "html",
    value: String(node.attrs.value),
  };
}

function taskListItemToMdast(
  node: ProseMirrorNode,
  _parent: ProseMirrorNode | undefined,
  state: FromProseMirrorState,
): ListItem {
  const children = state.all(node);
  const firstChild = children[0];

  if (
    firstChild?.type === "paragraph" &&
    firstChild.children.length === 0
  ) {
    firstChild.children.push({ type: "text", value: emptyTaskToken });
  }

  return {
    type: "listItem",
    checked: node.attrs.checked,
    spread: node.attrs.spread,
    children: children as ListItem["children"],
  };
}

function listItemToMdast(
  node: ProseMirrorNode,
  _parent: ProseMirrorNode | undefined,
  state: FromProseMirrorState,
): ListItem {
  const children = state.all(node);
  if (
    children[0]?.type === "paragraph" &&
    children[0].children.length === 0 &&
    node.childCount > 1 &&
    [
      gfmSchema.nodes.definition_list,
      gfmSchema.nodes.html_block_container,
      gfmSchema.nodes.picture,
      gfmSchema.nodes.raw_block,
    ].includes(node.child(1).type)
  ) {
    children.shift();
  }

  return {
    type: "listItem",
    checked: null,
    spread: node.attrs.spread,
    children: children as ListItem["children"],
  };
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

function parseSummaryMarkdown(
  value: string,
  context?: EditorContext,
): PhrasingContent[] {
  const encoded = encodeInlineHtmlMarks(value.trim());
  const summaryParser = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(createRemarkGitHubReferences(context))
    .use(createRemarkEmojiShortcodes());
  const tree = summaryParser.runSync(summaryParser.parse(encoded), {
    value: encoded,
  }) as Root;
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

function createRemarkEmptyTaskItems() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    visitMdastParents(tree, (parent) => {
      if (parent.type !== "listItem") return;
      const item = parent as ListItem;
      if (item.checked !== null) return;
      const paragraph = item.children[0];
      if (
        paragraph?.type !== "paragraph" ||
        paragraph.children.length !== 1 ||
        paragraph.children[0].type !== "text"
      ) {
        return;
      }

      const match = paragraph.children[0].value.match(/^\[([ xX])\]$/);
      if (!match) return;
      const sourceStart = paragraph.position?.start.offset;
      const sourceEnd = paragraph.position?.end.offset;
      if (
        typeof sourceStart !== "number" ||
        typeof sourceEnd !== "number" ||
        source.slice(sourceStart, sourceEnd) !== paragraph.children[0].value
      ) {
        return;
      }
      item.checked = match[1].toLowerCase() === "x";
      paragraph.children = [];
    });
  };
}

function createRemarkInlineHtmlMarks() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);

    visitMdastParents(tree, (parent) => {
      if (!isInlineHtmlParent(parent)) return;

      const children = parent.children;
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child.type !== "html") continue;

        const match = child.value.trim().match(/^<(sub|sup)>$/i);
        if (!match) continue;
        const tagName = match[1].toLowerCase();
        const closeIndex = children.findIndex(
          (candidate, candidateIndex) =>
            candidateIndex > index &&
            candidate.type === "html" &&
            candidate.value.trim().toLowerCase() === `</${tagName}>`,
        );
        if (closeIndex === -1) continue;

        const contentStart = child.position?.end.offset;
        const contentEnd = children[closeIndex].position?.start.offset;
        if (
          typeof contentStart !== "number" ||
          typeof contentEnd !== "number"
        ) {
          continue;
        }

        const tokenName = tagName === "sub" ? "SUB" : "SUP";
        const value = source.slice(contentStart, contentEnd);
        children.splice(index, closeIndex - index + 1, {
          type: "text",
          value: `@@GFMD_${tokenName}(${encodeInlineStylePayload(value)})@@`,
        });
      }
    });
  };
}

function visitMdastParents(
  parent: MdastParent | Root,
  visitor: (parent: MdastParent | Root) => void,
) {
  visitor(parent);
  for (const child of parent.children) {
    if ("children" in child) visitMdastParents(child, visitor);
  }
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
  return markdown
    .replace(new RegExp(`[ \\t]*${emptyTaskToken}(?=\\n|$)`, "g"), "")
    .replace(
      /^((?:[ \t]*>[ \t]*)+)\\(\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])(?=\n|$)/gim,
      "$1$2",
    )
    .replace(/\\#(?=\d)/g, "#");
}
