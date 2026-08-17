import { fromHtml } from "hast-util-from-html";
import type {
  Element as HastElement,
  RootContent as HastNode,
} from "hast";
import type {
  Html,
  Nodes as MdastNode,
  Parent as MdastParent,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";
import type {
  Mark,
  Node as ProseMirrorNode,
} from "prosemirror-model";
import type { Position } from "unist";
import { isSafeInteractionHref } from "../../link-url";
import {
  type FromProseMirrorState,
  type HandlerState,
} from "../../mdast-utils";
import { gfmSchema } from "../../schema";
import {
  type PictureImage,
  type PictureSource,
  type SafeHtmlAttributes,
  safeSrcset,
} from "./schema";

interface SafeHtmlInline extends MdastParent {
  type: "safeHtmlInline";
  attrs: Record<string, string>;
  children: PhrasingContent[];
  tagName: SafeInlineTag;
}

interface SafeHtmlContainer extends MdastParent {
  type: "safeHtmlContainer";
  attrs: SafeHtmlAttributes;
  children: RootContent[];
  sourceClose: string;
  sourceOpen: string;
  tagName: SafeContainerTag;
}

interface DefinitionList extends MdastParent {
  type: "definitionList";
  children: Array<DefinitionTerm | DefinitionDescription>;
}

interface DefinitionTerm extends MdastParent {
  type: "definitionTerm";
  children: PhrasingContent[];
}

interface DefinitionDescription extends MdastParent {
  type: "definitionDescription";
  children: RootContent[];
}

interface Picture {
  position?: Position;
  type: "picture";
  image: PictureImage;
  source: string;
  sources: PictureSource[];
}

declare module "mdast" {
  interface PhrasingContentMap {
    safeHtmlInline: SafeHtmlInline;
  }

  interface RootContentMap {
    definitionDescription: DefinitionDescription;
    definitionList: DefinitionList;
    definitionTerm: DefinitionTerm;
    picture: Picture;
    safeHtmlContainer: SafeHtmlContainer;
    safeHtmlInline: SafeHtmlInline;
  }
}

const inlineMarkNames = {
  ins: "insert",
  kbd: "keyboard_input",
  mark: "highlight",
  q: "quote",
  samp: "sample_output",
  sub: "subscript",
  sup: "superscript",
  tt: "teletype",
  var: "variable",
} as const;

type SafeContainerTag = "div" | "section";
type SafeInlineTag = keyof typeof inlineMarkNames;

export function createRemarkGitHubHtml() {
  return function remarkGitHubHtml() {
    return (tree: Root) => transformParent(tree);
  };
}

export function parseSafeHtmlInline(
  node: SafeHtmlInline,
  _parent: MdastParent,
  state: HandlerState,
) {
  const markName = inlineMarkNames[node.tagName];
  const markType = gfmSchema.marks[markName];
  if (!markType) return state.all(node);

  const mark = markType.create(node.attrs);
  return state.all(node).map((child) =>
    child.isInline ? child.mark(mark.addToSet(child.marks)) : child,
  );
}

export function parseSafeHtmlContainer(
  node: SafeHtmlContainer,
  _parent: MdastParent,
  state: HandlerState,
) {
  return gfmSchema.nodes.html_block_container.createAndFill(
    {
      attrs: node.attrs,
      sourceClose: node.sourceClose,
      sourceOpen: node.sourceOpen,
      tagName: node.tagName,
    },
    state.all(node),
  );
}

export function parseDefinitionList(
  node: DefinitionList,
  _parent: MdastParent,
  state: HandlerState,
) {
  return gfmSchema.nodes.definition_list.createAndFill(null, state.all(node));
}

export function parseDefinitionTerm(
  node: DefinitionTerm,
  _parent: MdastParent,
  state: HandlerState,
) {
  return gfmSchema.nodes.definition_term.create(null, state.all(node));
}

export function parseDefinitionDescription(
  node: DefinitionDescription,
  _parent: MdastParent,
  state: HandlerState,
) {
  return gfmSchema.nodes.definition_description.createAndFill(
    null,
    state.all(node),
  );
}

export function parsePicture(node: Picture) {
  return gfmSchema.nodes.picture.create({
    image: node.image,
    source: node.source,
    sources: node.sources,
  });
}

export function safeHtmlContainerToMdast(
  node: ProseMirrorNode,
  _parent: ProseMirrorNode | undefined,
  state: FromProseMirrorState,
): MdastNode[] {
  return [
    { type: "html", value: String(node.attrs.sourceOpen) },
    ...state.all(node),
    { type: "html", value: String(node.attrs.sourceClose) },
  ];
}

export function definitionListToMdast(
  node: ProseMirrorNode,
  _parent: ProseMirrorNode | undefined,
  state: FromProseMirrorState,
): MdastNode[] {
  const output: MdastNode[] = [{ type: "html", value: "<dl>" }];

  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child.type === gfmSchema.nodes.definition_term) {
      output.push({
        type: "html",
        value: `<dt>${inlineMdastToHtml(state.all(child))}</dt>`,
      });
    } else if (child.type === gfmSchema.nodes.definition_description) {
      output.push({ type: "html", value: "<dd>" });
      output.push(...state.all(child));
      output.push({ type: "html", value: "</dd>" });
    }
  }

  output.push({ type: "html", value: "</dl>" });
  return output;
}

export function pictureToMdast(node: ProseMirrorNode): Html {
  return { type: "html", value: String(node.attrs.source) };
}

export function safeHtmlMarkToMdast(
  mark: Mark,
  children: MdastNode[],
): Html {
  const tagName = markTagName(mark.type.name);
  const attrs = serializeMarkAttributes(mark);
  return {
    type: "html",
    value: `<${tagName}${attrs}>${inlineMdastToHtml(children)}</${tagName}>`,
  };
}

function transformParent(parent: MdastParent | Root) {
  if (canContainBlockHtml(parent)) {
    parent.children = transformBlockChildren(parent.children);
  }

  if (isPhrasingParent(parent)) {
    const phrasingParent = parent as unknown as {
      children: PhrasingContent[];
    };
    phrasingParent.children = groupInlineHtml(phrasingParent.children);
  }

  for (const child of parent.children) {
    if ("children" in child) transformParent(child);
  }
}

function transformBlockChildren(children: RootContent[]): RootContent[] {
  const converted: RootContent[] = children.map((child) =>
    child.type === "html"
      ? (parsePictureHtml(child.value) ??
        parseDefinitionListHtml(child.value) ??
        child)
      : child,
  );

  return groupDefinitionListBoundaries(groupSafeContainers(converted));
}

function groupSafeContainers(children: RootContent[]): RootContent[] {
  const output: RootContent[] = [];
  let index = 0;

  while (index < children.length) {
    const child = children[index];
    const htmlChild = child.type === "html" ? child : null;
    const opener = htmlChild ? safeContainerOpener(htmlChild.value) : null;
    if (!opener) {
      output.push(child);
      index += 1;
      continue;
    }

    const closeIndex = findContainerClose(children, index, opener.tagName);
    if (
      closeIndex === -1 ||
      hasAmbiguousHtmlBoundary(children.slice(index + 1, closeIndex))
    ) {
      output.push(child);
      index += 1;
      continue;
    }

    output.push({
      type: "safeHtmlContainer",
      attrs: opener.attrs,
      children: children.slice(index + 1, closeIndex),
      sourceClose: (children[closeIndex] as Html).value,
      sourceOpen: (child as Html).value,
      tagName: opener.tagName,
    });
    index = closeIndex + 1;
  }

  return output;
}

function groupDefinitionListBoundaries(
  children: RootContent[],
): RootContent[] {
  const output: RootContent[] = [];
  let index = 0;

  while (index < children.length) {
    if (!isExactHtml(children[index], "dl", "open")) {
      output.push(children[index]);
      index += 1;
      continue;
    }

    const closeIndex = children.findIndex(
      (child, childIndex) =>
        childIndex > index && isExactHtml(child, "dl", "close"),
    );
    if (closeIndex === -1) {
      output.push(children[index]);
      index += 1;
      continue;
    }

    const definitionList = definitionListFromBoundaryChildren(
      children.slice(index + 1, closeIndex),
    );
    if (!definitionList) {
      output.push(children[index]);
      index += 1;
      continue;
    }

    output.push(definitionList);
    index = closeIndex + 1;
  }

  return output;
}

function definitionListFromBoundaryChildren(
  children: RootContent[],
): DefinitionList | null {
  const definitions: Array<DefinitionTerm | DefinitionDescription> = [];
  let index = 0;

  while (index < children.length) {
    const child = children[index];
    const term =
      child?.type === "html"
        ? parseDefinitionItemHtml(child.value, "dt")
        : null;
    if (!term || term.type !== "definitionTerm") return null;
    definitions.push(term);
    index += 1;

    let descriptionCount = 0;
    while (index < children.length) {
      const child = children[index];
      const inlineDescription =
        child.type === "html"
          ? parseDefinitionItemHtml(child.value, "dd")
          : null;
      if (inlineDescription?.type === "definitionDescription") {
        definitions.push(inlineDescription);
        descriptionCount += 1;
        index += 1;
        continue;
      }
      if (!isExactHtml(child, "dd", "open")) break;

      const closeIndex = children.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index && isExactHtml(candidate, "dd", "close"),
      );
      if (closeIndex === -1) return null;
      definitions.push({
        type: "definitionDescription",
        children: children.slice(index + 1, closeIndex),
      });
      descriptionCount += 1;
      index = closeIndex + 1;
    }
    if (descriptionCount === 0) return null;
  }

  return { type: "definitionList", children: definitions };
}

function groupInlineHtml(
  sourceChildren: PhrasingContent[],
): PhrasingContent[] {
  const children = [...sourceChildren];

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.type !== "html") continue;

    const complete = parseInlineHtmlElement(child.value);
    if (complete) {
      children[index] = complete;
      continue;
    }

    const opener = safeInlineOpener(child.value);
    if (!opener) continue;

    let depth = 1;
    let closeIndex = index + 1;
    for (; closeIndex < children.length; closeIndex += 1) {
      const candidate = children[closeIndex];
      if (candidate.type !== "html") continue;
      if (safeInlineOpener(candidate.value)?.tagName === opener.tagName) {
        depth += 1;
      } else if (isExactHtml(candidate, opener.tagName, "close")) {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;

    const content = groupInlineHtml(
      children.slice(index + 1, closeIndex) as PhrasingContent[],
    );
    children.splice(index, closeIndex - index + 1, {
      type: "safeHtmlInline",
      attrs: opener.attrs,
      children: content,
      tagName: opener.tagName,
    });
  }

  return children;
}

function parsePictureHtml(value: string): Picture | null {
  const element = singleElement(value);
  if (!element || element.tagName !== "picture") return null;

  const sources: PictureSource[] = [];
  let image: PictureImage | null = null;
  for (const child of element.children) {
    if (child.type === "text" && !child.value.trim()) continue;
    if (child.type !== "element") return null;

    if (child.tagName === "source") {
      const srcset = propertyString(child, "srcSet", "srcset");
      if (!srcset || !safeSrcset(srcset)) return null;
      sources.push({
        media: propertyString(child, "media") ?? undefined,
        srcset,
        type: propertyString(child, "type") ?? undefined,
      });
    } else if (child.tagName === "img" && image === null) {
      const src = propertyString(child, "src");
      if (!src || !isSafeInteractionHref(src)) return null;
      image = {
        alt: propertyString(child, "alt") ?? undefined,
        height: propertyString(child, "height") ?? undefined,
        src,
        title: propertyString(child, "title") ?? undefined,
        width: propertyString(child, "width") ?? undefined,
      };
    } else {
      return null;
    }
  }

  return image ? { type: "picture", image, source: value, sources } : null;
}

function parseDefinitionListHtml(value: string): DefinitionList | null {
  const element = singleElement(value);
  if (!element || element.tagName !== "dl") return null;

  const children: Array<DefinitionTerm | DefinitionDescription> = [];
  for (const child of element.children) {
    if (child.type === "text" && !child.value.trim()) continue;
    if (child.type !== "element") return null;
    const parsed = definitionNodeFromElement(child);
    if (!parsed) return null;
    children.push(parsed);
  }

  return validDefinitionSequence(children)
    ? { type: "definitionList", children }
    : null;
}

function parseDefinitionItemHtml(
  value: string,
  tagName: "dd" | "dt",
) {
  if (!new RegExp(`</${tagName}\\s*>`, "i").test(value)) return null;
  const root = fromHtml(`<dl>${value}</dl>`, { fragment: true });
  const list = root.children.find(
    (child): child is HastElement =>
      child.type === "element" && child.tagName === "dl",
  );
  const element = list?.children.find(
    (child): child is HastElement =>
      child.type === "element" && child.tagName === tagName,
  );
  return element ? definitionNodeFromElement(element) : null;
}

function definitionNodeFromElement(
  element: HastElement,
): DefinitionTerm | DefinitionDescription | null {
  if (element.tagName === "dt") {
    const children = hastPhrasing(element.children);
    return children ? { type: "definitionTerm", children } : null;
  }
  if (element.tagName === "dd") {
    const children = hastBlocks(element.children);
    return children ? { type: "definitionDescription", children } : null;
  }
  return null;
}

function hastBlocks(children: HastNode[]): RootContent[] | null {
  const significant = children.filter(
    (child) => child.type !== "text" || child.value.trim(),
  );
  if (
    significant.every(
      (child) => child.type === "element" && child.tagName === "p",
    )
  ) {
    return significant.map((child) => ({
      type: "paragraph",
      children: hastPhrasing((child as HastElement).children) ?? [],
    }));
  }

  const phrasing = hastPhrasing(children);
  return phrasing ? [{ type: "paragraph", children: phrasing }] : null;
}

function hastPhrasing(children: HastNode[]): PhrasingContent[] | null {
  const output: PhrasingContent[] = [];
  for (const child of children) {
    if (child.type === "text") {
      output.push({ type: "text", value: child.value });
      continue;
    }
    if (child.type !== "element") return null;

    const nested = hastPhrasing(child.children);
    if (!nested) return null;
    if (child.tagName === "strong" || child.tagName === "b") {
      output.push({ type: "strong", children: nested });
    } else if (child.tagName === "em" || child.tagName === "i") {
      output.push({ type: "emphasis", children: nested });
    } else if (["del", "s", "strike"].includes(child.tagName)) {
      output.push({ type: "delete", children: nested });
    } else if (child.tagName === "code") {
      output.push({ type: "inlineCode", value: hastText(child) });
    } else if (child.tagName === "a") {
      const href = propertyString(child, "href") ?? "";
      if (!isSafeInteractionHref(href)) return null;
      output.push({
        type: "link",
        url: href,
        title: propertyString(child, "title"),
        children: nested,
      });
    } else if (child.tagName === "br") {
      output.push({ type: "break" });
    } else if (isSafeInlineTag(child.tagName)) {
      output.push({
        type: "safeHtmlInline",
        attrs: safeInlineAttributes(child.tagName, child),
        children: nested,
        tagName: child.tagName,
      });
    } else {
      return null;
    }
  }
  return output;
}

function safeContainerOpener(value: string) {
  const match = value.trim().match(/^<(div|section)\b[\s\S]*>$/i);
  if (!match || /<\/(?:div|section)\s*>/i.test(value)) return null;
  const tagName = match[1].toLowerCase() as SafeContainerTag;
  const element = singleElement(`${value}</${tagName}>`);
  return element?.tagName === tagName
    ? {
        attrs: safeContainerAttributes(element),
        tagName,
      }
    : null;
}

function safeInlineOpener(value: string) {
  const match = value.trim().match(
    /^<(ins|kbd|mark|q|samp|sub|sup|tt|var)\b[\s\S]*>$/i,
  );
  if (!match || /<\//.test(value)) return null;
  const tagName = match[1].toLowerCase() as SafeInlineTag;
  const element = singleElement(`${value}</${tagName}>`);
  return element?.tagName === tagName
    ? {
        attrs: safeInlineAttributes(tagName, element),
        tagName,
      }
    : null;
}

function parseInlineHtmlElement(value: string): SafeHtmlInline | null {
  if (!/<\/(?:ins|kbd|mark|q|samp|sub|sup|tt|var)\s*>/i.test(value)) {
    return null;
  }
  const element = singleElement(value);
  if (!element || !isSafeInlineTag(element.tagName)) return null;
  const children = hastPhrasing(element.children);
  return children
    ? {
        type: "safeHtmlInline",
        attrs: safeInlineAttributes(element.tagName, element),
        children,
        tagName: element.tagName,
      }
    : null;
}

function findContainerClose(
  children: RootContent[],
  openerIndex: number,
  tagName: SafeContainerTag,
) {
  const stack: SafeContainerTag[] = [tagName];
  for (let index = openerIndex + 1; index < children.length; index += 1) {
    const child = children[index];
    if (child.type !== "html") continue;
    const opener = safeContainerOpener(child.value);
    if (opener) {
      stack.push(opener.tagName);
      continue;
    }
    const top = stack.at(-1);
    if (top && isExactHtml(child, top, "close")) {
      stack.pop();
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

function hasAmbiguousHtmlBoundary(children: RootContent[]) {
  return children.some((child) => {
    if (child.type !== "html") return false;
    const value = child.value.trim();
    if (
      !value ||
      value.startsWith("<!--") ||
      safeContainerOpener(value) ||
      isExactHtml(child, "div", "close") ||
      isExactHtml(child, "section", "close") ||
      /^<[^>]+\/>$/.test(value) ||
      /^<(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)\b/i.test(
        value,
      ) ||
      /^<([a-z][\w:-]*)\b[^>]*>[\s\S]*<\/\1\s*>$/i.test(value)
    ) {
      return false;
    }
    return /^<\/?[a-z][\w:-]*\b[^>]*>$/i.test(value);
  });
}

function safeContainerAttributes(element: HastElement): SafeHtmlAttributes {
  return Object.fromEntries(
    ["align", "dir", "id", "lang", "title"]
      .map((name) => [name, propertyString(element, name)])
      .filter(([, value]) => value),
  );
}

function safeInlineAttributes(
  tagName: SafeInlineTag,
  element: HastElement,
) {
  const names =
    tagName === "ins" ? ["cite", "dateTime"] : tagName === "q" ? ["cite"] : [];
  return Object.fromEntries(
    names
      .map((name) => [
        name === "dateTime" ? "datetime" : name,
        propertyString(element, name, name.toLowerCase()),
      ])
      .filter(([, value]) => value),
  );
}

function singleElement(value: string): HastElement | null {
  const root = fromHtml(value, { fragment: true });
  const significant = root.children.filter(
    (child) => child.type !== "text" || child.value.trim(),
  );
  return significant.length === 1 && significant[0].type === "element"
    ? significant[0]
    : null;
}

function propertyString(
  element: HastElement,
  ...names: string[]
): string | null {
  for (const name of names) {
    const value = element.properties[name];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return null;
}

function hastText(element: HastElement): string {
  return element.children
    .map((child) =>
      child.type === "text"
        ? child.value
        : child.type === "element"
          ? hastText(child)
          : "",
    )
    .join("");
}

function validDefinitionSequence(
  children: Array<DefinitionTerm | DefinitionDescription>,
) {
  let hasDescription = false;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child.type === "definitionTerm") {
      if (!hasDescription && index > 0) return false;
      hasDescription = false;
    } else {
      hasDescription = true;
    }
  }
  return children[0]?.type === "definitionTerm" && hasDescription;
}

function canContainBlockHtml(
  parent: MdastParent | Root,
): parent is (MdastParent | Root) & { children: RootContent[] } {
  return [
    "blockquote",
    "definitionDescription",
    "details",
    "footnoteDefinition",
    "listItem",
    "root",
    "safeHtmlContainer",
  ].includes(parent.type);
}

function isPhrasingParent(
  parent: MdastParent | Root,
): parent is (MdastParent | Root) & { children: PhrasingContent[] } {
  return [
    "delete",
    "detailsSummary",
    "emphasis",
    "heading",
    "link",
    "paragraph",
    "safeHtmlInline",
    "strong",
    "tableCell",
  ].includes(parent.type);
}

function isExactHtml(
  node: RootContent | PhrasingContent | undefined,
  tagName: string,
  kind: "close" | "open",
) {
  if (node?.type !== "html") return false;
  const pattern =
    kind === "open"
      ? new RegExp(`^<${tagName}(?:\\s[^>]*)?>$`, "i")
      : new RegExp(`^</${tagName}\\s*>$`, "i");
  return pattern.test(node.value.trim());
}

function isSafeInlineTag(value: string): value is SafeInlineTag {
  return value in inlineMarkNames;
}

function inlineMdastToHtml(nodes: MdastNode[]): string {
  return nodes.map(mdastNodeToInlineHtml).join("");
}

function mdastNodeToInlineHtml(node: MdastNode): string {
  if (node.type === "text") return escapeHtml(node.value);
  if (node.type === "inlineCode") return `<code>${escapeHtml(node.value)}</code>`;
  if (node.type === "break") return "<br>";
  if (node.type === "html") return node.value;
  if (!("children" in node)) return "";

  const content = inlineMdastToHtml(node.children);
  if (node.type === "strong") return `<strong>${content}</strong>`;
  if (node.type === "emphasis") return `<em>${content}</em>`;
  if (node.type === "delete") return `<del>${content}</del>`;
  if (node.type === "link") {
    return `<a href="${escapeHtmlAttribute(node.url)}"${node.title ? ` title="${escapeHtmlAttribute(node.title)}"` : ""}>${content}</a>`;
  }
  if (node.type === "safeHtmlInline") {
    return `<${node.tagName}${serializeHtmlAttributes(node.attrs)}>${content}</${node.tagName}>`;
  }
  return content;
}

function markTagName(markName: string): SafeInlineTag {
  const match = Object.entries(inlineMarkNames).find(
    ([, value]) => value === markName,
  );
  if (!match) throw new Error(`Unsupported safe HTML mark: ${markName}`);
  return match[0] as SafeInlineTag;
}

function serializeMarkAttributes(mark: Mark) {
  const attrs: Record<string, string> = {};
  for (const [name, value] of Object.entries(mark.attrs)) {
    if (typeof value === "string" && value) attrs[name] = value;
  }
  return serializeHtmlAttributes(attrs);
}

function serializeHtmlAttributes(attrs: Record<string, string>) {
  const entries = Object.entries(attrs);
  return entries.length
    ? ` ${entries
        .map(
          ([name, value]) =>
            `${name}="${escapeHtmlAttribute(value)}"`,
        )
        .join(" ")}`
    : "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}
