import type {
  Html,
  Parent as MdastParent,
  PhrasingContent,
  Root,
  Text,
} from "mdast";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { Position } from "unist";
import type { EditorContext } from "../../types";
import { gfmSchema } from "../../schema";
import {
  githubMentionNode,
  githubReferenceNode,
  mentionPattern,
  referencePattern,
} from "./utils";

interface GitHubMention {
  source: string;
  team: string | null;
  type: "githubMention";
  username: string;
  position?: Position;
}

interface GitHubReference {
  number: number;
  owner: string;
  repo: string;
  source: string;
  type: "githubReference";
  position?: Position;
}

declare module "mdast" {
  interface PhrasingContentMap {
    githubMention: GitHubMention;
    githubReference: GitHubReference;
  }

  interface RootContentMap {
    githubMention: GitHubMention;
    githubReference: GitHubReference;
  }
}

export function createRemarkGitHubReferences(context?: EditorContext) {
  return function remarkGitHubReferences() {
    return (tree: Root, file: { value: unknown }) => {
      transformProjectText(tree, String(file.value), context);
    };
  };
}

export function parseGitHubMention(node: GitHubMention) {
  return githubMentionNode(node.source, node.username, node.team);
}

export function parseGitHubReference(node: GitHubReference) {
  return githubReferenceNode(
    node.source,
    node.owner,
    node.repo,
    node.number,
  );
}

export function projectTokenToMdast(node: ProseMirrorNode): Html {
  // A raw mdast leaf preserves the exact source token without Markdown escaping.
  return { type: "html", value: String(node.attrs.source) };
}

function transformProjectText(
  parent: MdastParent | Root,
  source: string,
  context?: EditorContext,
) {
  if (isEligiblePhrasingParent(parent)) {
    const phrasingParent = parent as unknown as {
      children: PhrasingContent[];
    };
    phrasingParent.children = phrasingParent.children.flatMap((child) =>
      child.type === "text"
        ? projectNodesFromText(child, source, context)
        : child,
    );
  }

  for (const child of parent.children) {
    if ("children" in child) transformProjectText(child, source, context);
  }
}

function projectNodesFromText(
  node: Text,
  source: string,
  context?: EditorContext,
): PhrasingContent[] {
  const matches = [
    ...tokenMatches(node.value, mentionPattern, "mention"),
    ...tokenMatches(node.value, referencePattern, "reference"),
  ].sort((left, right) => left.start - right.start);
  if (matches.length === 0) return [node];

  const sourceStart = node.position?.start.offset;
  const sourceEnd = node.position?.end.offset;
  const sourceValue =
    typeof sourceStart === "number" && typeof sourceEnd === "number"
      ? source.slice(sourceStart, sourceEnd)
      : node.value;
  const output: PhrasingContent[] = [];
  let cursor = 0;
  let sourceCursor = 0;

  for (const match of matches) {
    if (match.start < cursor) continue;
    const sourceIndex = sourceValue.indexOf(match.token, sourceCursor);
    if (sourceIndex === -1 && sourceValue !== node.value) continue;
    sourceCursor =
      sourceIndex >= 0 ? sourceIndex + match.token.length : sourceCursor;
    if (sourceIndex >= 0 && isEscaped(sourceValue, sourceIndex)) continue;

    if (match.start > cursor) {
      output.push({ type: "text", value: node.value.slice(cursor, match.start) });
    }

    if (match.kind === "mention") {
      output.push({
        type: "githubMention",
        source: match.token,
        username: match.parts[3],
        team: match.parts[4] ?? null,
      });
    } else {
      const owner = match.parts[3] ?? context?.owner;
      const repo = match.parts[4] ?? context?.repo;
      if (!owner || !repo) {
        output.push({ type: "text", value: match.token });
      } else {
        output.push({
          type: "githubReference",
          source: match.token,
          owner,
          repo,
          number: Number(match.parts[5]),
        });
      }
    }
    cursor = match.end;
  }

  if (cursor === 0) return [node];
  if (cursor < node.value.length) {
    output.push({ type: "text", value: node.value.slice(cursor) });
  }
  return output;
}

function tokenMatches(
  value: string,
  pattern: RegExp,
  kind: "mention" | "reference",
) {
  pattern.lastIndex = 0;
  const matches = [...value.matchAll(pattern)].map((parts) => {
    const start = (parts.index ?? 0) + parts[1].length;
    return {
      kind,
      parts,
      token: parts[2],
      start,
      end: start + parts[2].length,
    };
  });
  pattern.lastIndex = 0;
  return matches;
}

function isEscaped(value: string, index: number) {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function isEligiblePhrasingParent(
  parent: MdastParent | Root,
): parent is (MdastParent | Root) & { children: PhrasingContent[] } {
  return [
    "delete",
    "detailsSummary",
    "emphasis",
    "heading",
    "paragraph",
    "safeHtmlInline",
    "strong",
    "tableCell",
  ].includes(parent.type);
}
