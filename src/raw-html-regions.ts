import type {
  Nodes as MdastNode,
  Parent as MdastParent,
  Root,
  RootContent,
} from "mdast";
import type { VFile } from "vfile";

const voidElements = new Set([
  "area",
  "base",
  "basefont",
  "bgsound",
  "br",
  "col",
  "command",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const rawTextElements = new Set([
  "iframe",
  "noembed",
  "noframes",
  "script",
  "style",
  "textarea",
  "xmp",
]);

interface HtmlToken {
  kind: "open" | "close";
  name: string;
  start: number;
  end: number;
  selfClosing: boolean;
}

interface PositionedHtmlToken extends HtmlToken {
  absoluteStart: number;
  absoluteEnd: number;
}

interface RawHtmlRegionData {
  gfmdRawHtmlRegion: {
    tagName: string;
    malformed: boolean;
  };
}

type PositionedNode = MdastNode & {
  position?: {
    start: { column: number; offset?: number };
    end: { offset?: number };
  };
};

type HtmlNodeWithRegionData = RootContent & {
  type: "html";
  value: string;
  data?: RawHtmlRegionData;
};

export function createRemarkRawHtmlRegions() {
  return function remarkRawHtmlRegions() {
    return (tree: Root, file: VFile) => {
      const source = String(file.value);
      groupRawHtmlRegions(tree, source);
    };
  };
}

function groupRawHtmlRegions(parent: MdastParent | Root, source: string) {
  if (canContainBlockHtml(parent)) {
    parent.children = groupBlockChildren(parent.children, source);
  }

  for (const child of parent.children) {
    if (
      "children" in child &&
      child.type !== "paragraph" &&
      !isRawHtmlRegion(child)
    ) {
      groupRawHtmlRegions(child, source);
    }
  }
}

function canContainBlockHtml(
  parent: MdastParent | Root,
): parent is (MdastParent | Root) & { children: RootContent[] } {
  return ["blockquote", "details", "footnoteDefinition", "listItem", "root"].includes(
    parent.type,
  );
}

function groupBlockChildren(
  children: RootContent[],
  source: string,
): RootContent[] {
  const remaining = [...children];
  const grouped: RootContent[] = [];
  let index = 0;

  while (index < remaining.length) {
    const child = remaining[index];
    const opener = rawContainerOpener(child, source);
    if (!opener) {
      grouped.push(child);
      index += 1;
      continue;
    }

    const match = findRegionEnd(remaining, index, opener, source);
    const finalIndex = match?.childIndex ?? remaining.length - 1;
    const startOffset = opener.absoluteStart;
    const endOffset =
      match?.offset ?? nodeEndOffset(remaining[finalIndex]) ?? opener.absoluteEnd;
    const contentPrefixOffset =
      match?.prefix ?? nodeStartOffset(remaining[finalIndex]) ?? startOffset;

    if (endOffset <= startOffset) {
      grouped.push(child);
      index += 1;
      continue;
    }

    grouped.push(
      rawHtmlRegionNode(
        containerRelativeSlice(source, startOffset, endOffset, contentPrefixOffset),
        opener.name,
        match?.malformed ?? true,
      ),
    );

    const trailing =
      match?.trailing ??
      trailingHtml(remaining[finalIndex], endOffset, source);
    if (trailing) {
      remaining[finalIndex] = trailing;
      index = finalIndex;
    } else {
      index = finalIndex + 1;
    }
  }

  return grouped;
}

function rawContainerOpener(
  node: RootContent | undefined,
  source: string,
): PositionedHtmlToken | null {
  if (node?.type !== "html" || isRawHtmlRegion(node)) return null;

  const tokens = positionedTokens(node, source);
  const opener = tokens[0];
  if (
    !opener ||
    opener.kind !== "open" ||
    opener.selfClosing ||
    voidElements.has(opener.name) ||
    node.value.slice(0, opener.start).trim() !== ""
  ) {
    return null;
  }

  return opener;
}

function findRegionEnd(
  children: RootContent[],
  startIndex: number,
  opener: PositionedHtmlToken,
  source: string,
) {
  const stack = [opener.name];
  let malformed = false;

  for (let childIndex = startIndex; childIndex < children.length; childIndex += 1) {
    const child = children[childIndex];
    for (const event of positionedTokensInChild(child, source)) {
      const { token } = event;
      if (childIndex === startIndex && token.absoluteStart <= opener.absoluteStart) {
        continue;
      }

      if (token.kind === "open") {
        if (!token.selfClosing && !voidElements.has(token.name)) {
          stack.push(token.name);
        }
        continue;
      }

      const top = stack.at(-1);
      if (token.name === top) {
        stack.pop();
      } else {
        const matchingDepth = stack.lastIndexOf(token.name);
        malformed = true;
        if (matchingDepth !== -1) stack.splice(matchingDepth);
      }

      if (stack.length === 0) {
        const split = trailingAfterMatch(child, event.node, token, source);
        return {
          childIndex,
          malformed,
          offset: split?.regionEnd ?? token.absoluteEnd,
          prefix: nodeStartOffset(child) ?? token.absoluteStart,
          trailing: split?.trailing ?? null,
        };
      }

    }
  }

  return null;
}

function positionedTokensInChild(
  child: RootContent,
  source: string,
): Array<{
  node: Extract<MdastNode, { type: "html" }>;
  token: PositionedHtmlToken;
}> {
  const events: Array<{
    node: Extract<MdastNode, { type: "html" }>;
    token: PositionedHtmlToken;
  }> = [];

  visitHtmlNodes(child, (node) => {
    for (const token of positionedTokens(node, source)) {
      events.push({ node, token });
    }
  });

  return events.sort(
    (left, right) => left.token.absoluteStart - right.token.absoluteStart,
  );
}

function visitHtmlNodes(
  node: MdastNode,
  visitor: (node: Extract<MdastNode, { type: "html" }>) => void,
) {
  if (node.type === "html") {
    visitor(node);
    return;
  }
  if ("children" in node) {
    for (const child of node.children) visitHtmlNodes(child, visitor);
  }
}

function positionedTokens(
  node: Extract<RootContent, { type: "html" }>,
  source: string,
): PositionedHtmlToken[] {
  const start = nodeStartOffset(node);
  const end = nodeEndOffset(node);
  if (start === null || end === null) return [];

  const sourceWindow = source.slice(start, end);
  let searchFrom = 0;

  return tokenizeHtml(node.value).flatMap((token) => {
    const raw = node.value.slice(token.start, token.end);
    const relativeStart = sourceWindow.indexOf(raw, searchFrom);
    if (relativeStart === -1) return [];

    searchFrom = relativeStart + raw.length;
    return [
      {
        ...token,
        absoluteStart: start + relativeStart,
        absoluteEnd: start + relativeStart + raw.length,
      },
    ];
  });
}

function tokenizeHtml(value: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let index = 0;

  while (index < value.length) {
    const start = value.indexOf("<", index);
    if (start === -1) break;

    if (value.startsWith("<!--", start)) {
      const commentEnd = value.indexOf("-->", start + 4);
      index = commentEnd === -1 ? value.length : commentEnd + 3;
      continue;
    }
    if (value.startsWith("<![CDATA[", start)) {
      const cdataEnd = value.indexOf("]]>", start + 9);
      index = cdataEnd === -1 ? value.length : cdataEnd + 3;
      continue;
    }
    if (value[start + 1] === "!" || value[start + 1] === "?") {
      index = markupEnd(value, start + 2);
      continue;
    }

    let cursor = start + 1;
    let kind: HtmlToken["kind"] = "open";
    if (value[cursor] === "/") {
      kind = "close";
      cursor += 1;
    }

    const nameStart = cursor;
    while (cursor < value.length && isTagNameCharacter(value[cursor])) cursor += 1;
    if (cursor === nameStart) {
      index = start + 1;
      continue;
    }

    const name = value.slice(nameStart, cursor).toLowerCase();
    let quote: "'" | '"' | null = null;
    while (cursor < value.length) {
      const character = value[cursor];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === "'" || character === '"') {
        quote = character;
      } else if (character === ">") {
        break;
      }
      cursor += 1;
    }

    if (cursor >= value.length) break;

    let beforeClose = cursor - 1;
    while (beforeClose > nameStart && /\s/.test(value[beforeClose])) {
      beforeClose -= 1;
    }
    const selfClosing = kind === "open" && value[beforeClose] === "/";
    tokens.push({ kind, name, start, end: cursor + 1, selfClosing });
    index = cursor + 1;

    if (kind === "open" && !selfClosing && rawTextElements.has(name)) {
      const rawTextClose = findRawTextClose(value, name, index);
      if (rawTextClose) {
        tokens.push(rawTextClose);
        index = rawTextClose.end;
      } else {
        index = value.length;
      }
    }
  }

  return tokens;
}

function markupEnd(value: string, start: number) {
  let quote: "'" | '"' | null = null;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  return value.length;
}

function findRawTextClose(
  value: string,
  name: string,
  start: number,
): HtmlToken | null {
  const lowerValue = value.toLowerCase();
  let candidate = lowerValue.indexOf(`</${name}`, start);

  while (candidate !== -1) {
    const afterName = candidate + name.length + 2;
    if (/[\s>]/.test(value[afterName] ?? "")) {
      const end = value.indexOf(">", afterName);
      if (end === -1) return null;
      return {
        kind: "close",
        name,
        start: candidate,
        end: end + 1,
        selfClosing: false,
      };
    }
    candidate = lowerValue.indexOf(`</${name}`, afterName);
  }

  return null;
}

function isTagNameCharacter(character: string | undefined) {
  return character !== undefined && /[A-Za-z0-9:-]/.test(character);
}

function containerRelativeSlice(
  source: string,
  start: number,
  end: number,
  contentPrefixOffset: number,
) {
  const value = source.slice(start, end);
  const lineStart = source.lastIndexOf("\n", contentPrefixOffset - 1) + 1;
  const containerPrefix = source.slice(lineStart, contentPrefixOffset);
  if (!containerPrefix || !value.includes("\n")) return value;

  const lines = value.split("\n");
  return [
    lines[0],
    ...lines.slice(1).map((line) => stripContainerPrefix(line, containerPrefix)),
  ].join("\n");
}

function stripContainerPrefix(line: string, prefix: string) {
  const segments = prefix.split(">");
  let cursor = 0;

  for (let index = 0; index < segments.length; index += 1) {
    cursor = removeIndentColumns(line, cursor, visualWidth(segments[index]));
    if (index < segments.length - 1 && line[cursor] === ">") {
      cursor += 1;
    }
  }

  return line.slice(cursor);
}

function removeIndentColumns(line: string, start: number, columns: number) {
  let cursor = start;
  let consumed = 0;

  while (cursor < line.length && consumed < columns) {
    if (line[cursor] === " ") {
      consumed += 1;
    } else if (line[cursor] === "\t") {
      consumed += 4 - (consumed % 4);
    } else {
      break;
    }
    cursor += 1;
  }

  return cursor;
}

function visualWidth(value: string) {
  let width = 0;
  for (const character of value) {
    width =
      character === "\t"
        ? width + (4 - (width % 4))
        : width + 1;
  }
  return width;
}

function trailingAfterMatch(
  child: RootContent,
  htmlNode: Extract<MdastNode, { type: "html" }>,
  token: PositionedHtmlToken,
  source: string,
): { trailing: RootContent | null; regionEnd?: number } | null {
  if (child.type === "html") {
    const childEnd = nodeEndOffset(child);
    if (childEnd === null || token.absoluteEnd >= childEnd) {
      return { trailing: null };
    }

    const trailingSource = source.slice(token.absoluteEnd, childEnd);
    const firstTrailingToken = tokenizeHtml(trailingSource)[0];
    if (
      firstTrailingToken &&
      trailingSource.slice(0, firstTrailingToken.start).trim() === ""
    ) {
      return { trailing: trailingHtml(child, token.absoluteEnd, source) };
    }

    return { trailing: null, regionEnd: childEnd };
  }
  if (child.type !== "paragraph") return null;

  const htmlIndex = child.children.indexOf(htmlNode);
  if (htmlIndex === -1) {
    const paragraphEnd = nodeEndOffset(child);
    if (paragraphEnd === null || token.absoluteEnd >= paragraphEnd) return null;
    return {
      trailing: null,
      regionEnd: paragraphEnd,
    };
  }

  const trailingChildren = child.children.slice(htmlIndex + 1);
  const htmlEnd = nodeEndOffset(htmlNode as RootContent);
  if (htmlEnd !== null && token.absoluteEnd < htmlEnd) {
    trailingChildren.unshift({
      type: "html",
      value: source.slice(token.absoluteEnd, htmlEnd),
    });
  }
  if (trailingChildren.length === 0) return { trailing: null };

  return {
    trailing: {
      type: "paragraph",
      children: trailingChildren,
    },
  };
}

export function isStandaloneHtmlElement(value: string, tagName: string) {
  const tokens = tokenizeHtml(value);
  if (tokens.length !== 1) return false;

  const token = tokens[0];
  return (
    token.kind === "open" &&
    token.name === tagName.toLowerCase() &&
    value.slice(0, token.start).trim() === "" &&
    value.slice(token.end).trim() === ""
  );
}

function trailingHtml(
  node: RootContent | undefined,
  regionEnd: number,
  source: string,
): RootContent | null {
  if (node?.type !== "html") return null;
  const nodeEnd = nodeEndOffset(node);
  if (nodeEnd === null || regionEnd >= nodeEnd) return null;

  const value = source.slice(regionEnd, nodeEnd);
  return value
    ? ({
        type: "html",
        value,
        position: {
          start: sourcePoint(source, regionEnd),
          end: sourcePoint(source, nodeEnd),
        },
      } as RootContent)
    : null;
}

function sourcePoint(source: string, offset: number) {
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  return { line, column: offset - lineStart + 1, offset };
}

function rawHtmlRegionNode(
  value: string,
  tagName: string,
  malformed: boolean,
): HtmlNodeWithRegionData {
  return {
    type: "html",
    value,
    data: {
      gfmdRawHtmlRegion: {
        tagName,
        malformed,
      },
    },
  };
}

function isRawHtmlRegion(node: MdastNode): node is HtmlNodeWithRegionData {
  return Boolean(
    node.type === "html" &&
      (node as HtmlNodeWithRegionData).data?.gfmdRawHtmlRegion,
  );
}

function nodeStartOffset(node: RootContent | undefined) {
  const offset = (node as PositionedNode | undefined)?.position?.start.offset;
  return typeof offset === "number" ? offset : null;
}

function nodeEndOffset(node: RootContent | undefined) {
  const offset = (node as PositionedNode | undefined)?.position?.end.offset;
  return typeof offset === "number" ? offset : null;
}
