import type {
  Details,
  DetailsSummary,
  Html,
  Nodes as MdastNode,
  Paragraph,
  Parent as MdastParent,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";
import type { Node as ProseMirrorNode } from "prosemirror-model";

import {
  isPhrasingContent,
  type FromProseMirrorState,
  type HandlerState,
} from "../../mdast-utils";
import { gfmSchema } from "../../schema";

declare module "mdast" {
  interface Details extends MdastParent {
    type: "details";
    open: boolean;
    implicitSummary?: boolean;
    children: Array<DetailsSummary | RootContent>;
  }

  interface DetailsSummary extends MdastParent {
    type: "detailsSummary";
    children: PhrasingContent[];
  }

  interface RootContentMap {
    details: Details;
    detailsSummary: DetailsSummary;
  }
}

const defaultDetailsSummary = "Details";

type SummaryParser = (value: string) => PhrasingContent[];
type MarkdownStringifier = (tree: Root) => string;

export function createRemarkDetails(parseSummary: SummaryParser) {
  return function remarkDetails() {
    return (tree: Root) => {
      groupDetailsChildren(tree, parseSummary);
    };
  };
}

export function parseDetails(
  node: Details,
  _parent: MdastParent,
  state: HandlerState,
) {
  const details = gfmSchema.nodes.details.createAndFill(
    { open: node.open, implicitSummary: node.implicitSummary ?? false },
    state.all(node),
  );
  if (!details) {
    throw new Error("Could not create details block from Markdown.");
  }

  return details;
}

export function parseDetailsSummary(
  node: DetailsSummary,
  _parent: MdastParent,
  state: HandlerState,
) {
  const phrasingParent: Paragraph = {
    type: "paragraph",
    children: node.children,
  };
  const content = node.children.flatMap((child) => {
    const parsed = state.one(child, phrasingParent);
    if (Array.isArray(parsed)) return parsed;
    return parsed ? [parsed] : [];
  });
  const summary = gfmSchema.nodes.details_summary.createAndFill(null, content);
  if (!summary) {
    throw new Error("Could not create details summary from Markdown.");
  }

  return summary;
}

export function detailsToMdast(
  node: ProseMirrorNode,
  _parent: ProseMirrorNode | undefined,
  state: FromProseMirrorState,
  stringifyMarkdown: MarkdownStringifier,
): MdastNode[] {
  const summary = node.firstChild;
  const children: MdastNode[] = [
    {
      type: "html",
      value:
        node.attrs.implicitSummary &&
        summary?.textContent === defaultDetailsSummary
          ? `<details${node.attrs.open ? " open" : ""}>`
          : `<details${node.attrs.open ? " open" : ""}>\n<summary>${detailsSummaryMarkdown(
              summary,
              state,
              stringifyMarkdown,
            )}</summary>`,
    },
  ];

  for (let index = 1; index < node.childCount; index += 1) {
    const child = state.one(node.child(index), node);
    if (Array.isArray(child)) {
      children.push(...child);
    } else if (child) {
      children.push(child);
    }
  }

  children.push({ type: "html", value: "</details>" });
  return children;
}

function groupDetailsChildren(
  parent: MdastParent | Root,
  parseSummary: SummaryParser,
) {
  if (canContainBlockDetails(parent)) {
    parent.children = groupDetails(parent.children, parseSummary);
  }

  for (const child of parent.children) {
    if ("children" in child) {
      groupDetailsChildren(child, parseSummary);
    }
  }
}

function canContainBlockDetails(
  parent: MdastParent | Root,
): parent is (MdastParent | Root) & { children: RootContent[] } {
  return ["blockquote", "details", "footnoteDefinition", "listItem", "root"].includes(
    parent.type,
  );
}

function groupDetails(
  sourceChildren: RootContent[],
  parseSummary: SummaryParser,
): RootContent[] {
  const children = expandDetailsHtml(sourceChildren);
  const grouped: RootContent[] = [];
  let index = 0;

  while (index < children.length) {
    const opener = detailsOpener(children[index]);
    if (!opener) {
      grouped.push(children[index]);
      index += 1;
      continue;
    }

    let summary = opener.summary;
    let bodyStart = index + 1;
    const nextSummary = summaryHtml(children[bodyStart]);
    if (summary === null && nextSummary !== null) {
      summary = nextSummary;
      bodyStart += 1;
    }

    const closeIndex = findDetailsClose(children, bodyStart);
    if (closeIndex === -1) {
      grouped.push(children[index]);
      index += 1;
      continue;
    }

    const implicitSummary = summary === null;
    summary ??= defaultDetailsSummary;

    grouped.push({
      type: "details",
      open: opener.open,
      implicitSummary,
      children: [
        {
          type: "detailsSummary",
          children: parseSummary(summary),
        },
        ...children.slice(bodyStart, closeIndex),
      ],
    });
    index = closeIndex + 1;
  }

  return grouped;
}

function expandDetailsHtml(children: RootContent[]): RootContent[] {
  const expanded: RootContent[] = [];

  for (const child of children) {
    if (child.type !== "html") {
      expanded.push(child);
      continue;
    }

    const lines = child.value
      .trim()
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length <= 1 || !lines.every(isDetailsHtmlLine)) {
      expanded.push(child);
      continue;
    }

    for (const value of lines) {
      expanded.push({ ...child, value } as RootContent);
    }
  }

  return expanded;
}

function isDetailsHtmlLine(value: string) {
  return (
    /^<details(?:\s[^>]*)?>\s*$/i.test(value) ||
    /^<summary>[\s\S]*<\/summary>\s*$/i.test(value) ||
    /^<\/details>\s*$/i.test(value)
  );
}

function detailsOpener(node: RootContent | undefined) {
  if (node?.type !== "html") return null;

  const match = node.value
    .trim()
    .match(
      /^<details(?<attrs>(?:\s[^>]*)?)>\s*(?:<summary>(?<summary>[\s\S]*?)<\/summary>)?\s*$/i,
    );
  if (!match?.groups) return null;

  return {
    open: /\sopen(?:\s*=\s*(?:"open"|'open'|open))?(?=\s|$)/i.test(
      match.groups.attrs,
    ),
    summary: match.groups.summary ?? null,
  };
}

function summaryHtml(node: RootContent | undefined) {
  if (node?.type !== "html") return null;

  const match = node.value
    .trim()
    .match(/^<summary>(?<summary>[\s\S]*?)<\/summary>\s*$/i);
  return match?.groups?.summary ?? null;
}

function findDetailsClose(children: RootContent[], start: number) {
  let depth = 0;

  for (let index = start; index < children.length; index += 1) {
    const child = children[index];
    if (detailsOpener(child)) {
      depth += 1;
      continue;
    }

    if (isDetailsClose(child)) {
      if (depth === 0) return index;
      depth -= 1;
    }
  }

  return -1;
}

function isDetailsClose(node: RootContent | undefined) {
  return node?.type === "html" && /^<\/details>\s*$/i.test(node.value.trim());
}

function detailsSummaryMarkdown(
  node: ProseMirrorNode | null,
  state: FromProseMirrorState,
  stringifyMarkdown: MarkdownStringifier,
) {
  if (!node) return "";

  const summaryChildren = state.all(node).flatMap((child): PhrasingContent[] => {
    if (isPhrasingContent(child)) return [child];
    if ("value" in child && typeof child.value === "string") {
      return [{ type: "text", value: child.value }];
    }
    return [];
  });

  return stringifyMarkdown({
    type: "root",
    children: [{ type: "paragraph", children: summaryChildren }],
  }).trim();
}
