import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorContext } from "../../types";
import { gfmSchema } from "../../schema";

const accountName = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?";
const teamName = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?";
const repoName = "[A-Za-z0-9._-]+";

export const mentionPattern = new RegExp(
  `(^|[^\\w@])(@(${accountName})(?:\\/(${teamName}))?)(?=$|[^\\w@/-])`,
  "g",
);

export const referencePattern = new RegExp(
  `(^|[^\\w/#])((?:(${accountName})\\/(${repoName}))?#([1-9]\\d*))(?=$|[^\\w])`,
  "g",
);

export function githubMentionNode(
  source: string,
  username: string,
  team: string | null = null,
) {
  return gfmSchema.nodes.github_mention.create({ source, username, team });
}

export function githubReferenceNode(
  source: string,
  owner: string,
  repo: string,
  number: number,
) {
  return gfmSchema.nodes.github_reference.create({
    source,
    owner,
    repo,
    number,
  });
}

export function githubMentionHref(username: string, team?: string | null) {
  return team
    ? `https://github.com/orgs/${encodeURIComponent(username)}/teams/${encodeURIComponent(team)}`
    : `https://github.com/${encodeURIComponent(username)}`;
}

export function githubReferenceHref(
  owner: string,
  repo: string,
  number: number,
) {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`;
}

export function projectNodeFromToken(
  token: string,
  context?: EditorContext,
): ProseMirrorNode | null {
  const mention = exactMatch(mentionPattern, token);
  if (mention) {
    return githubMentionNode(token, mention[3], mention[4] ?? null);
  }

  const reference = exactMatch(referencePattern, token);
  if (!reference) return null;
  const owner = reference[3] ?? context?.owner;
  const repo = reference[4] ?? context?.repo;
  if (!owner || !repo) return null;

  return githubReferenceNode(token, owner, repo, Number(reference[5]));
}

function exactMatch(pattern: RegExp, value: string) {
  pattern.lastIndex = 0;
  const match = pattern.exec(value);
  pattern.lastIndex = 0;
  return match?.[2] === value ? match : null;
}
