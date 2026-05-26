import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { NodeView } from "prosemirror-view";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GFMarkdownEditorProps } from "../../editor-types";
import type { GitHubMention, ResolvedValue } from "../../types";

export class MentionNodeView implements NodeView {
  dom: HTMLElement;
  private root: Root;
  private alive = true;
  private resolved: ResolvedValue<GitHubMention> = { status: "loading" };

  constructor(
    private node: ProseMirrorNode,
    private optionsRef: React.MutableRefObject<GFMarkdownEditorProps>,
  ) {
    this.dom = document.createElement("span");
    this.root = createRoot(this.dom);
    this.resolve();
    this.render();
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    const changed = node.attrs.username !== this.node.attrs.username;
    this.node = node;
    if (changed) this.resolve();
    this.render();
    return true;
  }

  destroy() {
    this.alive = false;
    this.root.unmount();
  }

  private async resolve() {
    const options = this.optionsRef.current;
    if (!options.mentionResolver) {
      this.resolved = { status: "missing" };
      this.render();
      return;
    }

    this.resolved = { status: "loading" };
    this.render();

    try {
      const value = await options.mentionResolver.resolveMention(this.node.attrs.username, options.context);
      if (!this.alive) return;
      this.resolved = value ? { status: "resolved", value } : { status: "missing" };
    } catch (error) {
      if (!this.alive) return;
      this.resolved = { status: "error", error };
    }
    this.render();
  }

  private render() {
    this.root.render(<MentionChip node={this.node} resolved={this.resolved} />);
  }
}

export function MentionChip({ node, resolved }: { node: ProseMirrorNode; resolved: ResolvedValue<GitHubMention> }) {
  const username = node.attrs.username;
  const value = resolved.value;

  return (
    <span className="gfmd-mention" data-state={value ? "resolved" : resolved.status} title={value?.displayName ?? `@${username}`}>
      {value?.avatarUrl ? (
        <img
          alt=""
          className="gfmd-mention-avatar"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
          src={value.avatarUrl}
        />
      ) : null}
      <span>@{value?.username ?? username}</span>
    </span>
  );
}
