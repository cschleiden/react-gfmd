import type { NodeSpec } from "prosemirror-model";
import { githubMentionHref, githubReferenceHref } from "./utils";

export const githubMentionNodeSpec: NodeSpec = {
  attrs: {
    source: { validate: "string" },
    username: { validate: "string" },
    team: { default: null, validate: "string|null" },
  },
  atom: true,
  group: "inline",
  inline: true,
  selectable: true,
  parseDOM: [
    {
      tag: "[data-gfmd-mention]",
      getAttrs: mentionAttrsFromDOM,
    },
    {
      tag: "a.user-mention[href]",
      priority: 100,
      getAttrs: mentionAttrsFromDOM,
    },
    {
      tag: "a.team-mention[href]",
      priority: 100,
      getAttrs: mentionAttrsFromDOM,
    },
  ],
  toDOM: (node) => [
    "a",
    {
      "aria-label": node.attrs.team
        ? `Mention ${node.attrs.username}/${node.attrs.team}`
        : `Mention ${node.attrs.username}`,
      "data-gfmd-mention": "",
      "data-team": node.attrs.team,
      "data-username": node.attrs.username,
      class: node.attrs.team
        ? "team-mention gfmd-mention"
        : "user-mention notranslate gfmd-mention",
      contenteditable: "false",
      href: githubMentionHref(node.attrs.username, node.attrs.team),
    },
    node.attrs.source,
  ],
};

export const githubReferenceNodeSpec: NodeSpec = {
  attrs: {
    number: { validate: "number" },
    owner: { validate: "string" },
    repo: { validate: "string" },
    source: { validate: "string" },
  },
  atom: true,
  group: "inline",
  inline: true,
  selectable: true,
  parseDOM: [
    {
      tag: "[data-gfmd-reference]",
      getAttrs: referenceAttrsFromDOM,
    },
    {
      tag: "a.issue-link[href]",
      priority: 100,
      getAttrs: referenceAttrsFromDOM,
    },
  ],
  toDOM: (node) => [
    "a",
    {
      "aria-label": `${node.attrs.owner}/${node.attrs.repo} number ${node.attrs.number}`,
      "data-gfmd-reference": "",
      "data-number": node.attrs.number,
      "data-owner": node.attrs.owner,
      "data-repo": node.attrs.repo,
      class: "issue-link js-issue-link gfmd-reference",
      contenteditable: "false",
      href: githubReferenceHref(
        node.attrs.owner,
        node.attrs.repo,
        node.attrs.number,
      ),
    },
    node.attrs.source,
  ],
};

function mentionAttrsFromDOM(node: Node | string) {
  if (!(node instanceof HTMLElement)) return false;
  const source = node.dataset.source ?? node.textContent ?? "";
  const match = source.match(/^@([^/\s]+)(?:\/([^/\s]+))?$/);
  if (!match) return false;

  return {
    source,
    username: node.dataset.username ?? match[1],
    team: node.dataset.team ?? match[2] ?? null,
  };
}

function referenceAttrsFromDOM(node: Node | string) {
  if (!(node instanceof HTMLElement)) return false;
  const source = node.dataset.source ?? node.textContent ?? "";
  const dataNumber = Number(node.dataset.number);
  if (node.dataset.owner && node.dataset.repo && dataNumber > 0) {
    return {
      source,
      owner: node.dataset.owner,
      repo: node.dataset.repo,
      number: dataNumber,
    };
  }

  const href = node.getAttribute("href") ?? "";
  const match = href.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/([1-9]\d*)(?:[/?#]|$)/,
  );
  if (!match) return false;

  return {
    source,
    owner: match[1],
    repo: match[2],
    number: Number(match[3]),
  };
}
