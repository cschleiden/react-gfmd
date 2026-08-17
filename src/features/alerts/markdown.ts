import type {
  Blockquote,
  Nodes as MdastNode,
  Paragraph,
  Parent as MdastParent,
  Root,
  RootContent,
  Text,
} from "mdast";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type {
  FromProseMirrorState,
  HandlerState,
} from "../../mdast-utils";
import { gfmSchema } from "../../schema";
import { isAlertKind, type AlertKind } from "./model";

declare module "mdast" {
  interface GithubAlert extends MdastParent {
    type: "githubAlert";
    kind: AlertKind;
    children: RootContent[];
  }

  interface RootContentMap {
    githubAlert: GithubAlert;
  }
}

interface GithubAlert extends MdastParent {
  type: "githubAlert";
  kind: AlertKind;
  children: RootContent[];
}

const alertMarkerPattern =
  /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;

export function createRemarkGitHubAlerts() {
  return function remarkGitHubAlerts() {
    return (tree: Root) => {
      transformAlerts(tree);
    };
  };
}

export function parseAlert(
  node: GithubAlert,
  _parent: MdastParent,
  state: HandlerState,
) {
  const alert = gfmSchema.nodes.alert.createAndFill(
    { kind: node.kind },
    state.all(node),
  );
  if (!alert) {
    throw new Error("Could not create GitHub alert from Markdown.");
  }
  return alert;
}

export function alertToMdast(
  node: ProseMirrorNode,
  _parent: ProseMirrorNode | undefined,
  state: FromProseMirrorState,
): Blockquote {
  const children = state.all(node) as RootContent[];
  const first = children[0];
  const marker: Text = {
    type: "text",
    value: `[!${String(node.attrs.kind).toUpperCase()}]${
      first?.type === "paragraph" && first.children.length ? "\n" : ""
    }`,
  };

  if (first?.type === "paragraph") {
    children[0] = {
      ...first,
      children: [marker, ...first.children],
    };
  } else {
    children.unshift({ type: "paragraph", children: [marker] });
  }

  return {
    type: "blockquote",
    children: children as Blockquote["children"],
  };
}

function transformAlerts(parent: MdastParent | Root) {
  parent.children = parent.children.map((child) => {
    const alert =
      child.type === "blockquote" ? alertFromBlockquote(child) : null;
    return alert ?? child;
  });

  for (const child of parent.children) {
    if ("children" in child) transformAlerts(child);
  }
}

function alertFromBlockquote(node: Blockquote): GithubAlert | null {
  const first = node.children[0];
  if (first?.type !== "paragraph") return null;

  const firstInline = first.children[0];
  if (firstInline?.type !== "text") return null;

  const match = firstInline.value.match(alertMarkerPattern);
  const matchedKind = match?.[1]?.toLowerCase();
  if (!match || !isAlertKind(matchedKind)) return null;

  const paragraph: Paragraph = {
    ...first,
    children: [...first.children],
  };
  const remainder = firstInline.value.slice(match[0].length);
  if (remainder) {
    paragraph.children[0] = { ...firstInline, value: remainder };
  } else {
    paragraph.children.shift();
  }

  const children =
    paragraph.children.length === 0 && node.children.length > 1
      ? node.children.slice(1)
      : [paragraph, ...node.children.slice(1)];

  return {
    type: "githubAlert",
    kind: matchedKind,
    children,
  };
}
