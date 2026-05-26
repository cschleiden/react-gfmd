import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { NodeView } from "prosemirror-view";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { GFMarkdownEditorProps } from "../../editor-types";
import type { GitHubReference, ReferenceToken, ResolvedValue } from "../../types";

export class ReferenceNodeView implements NodeView {
  dom: HTMLElement;
  private root: Root;
  private alive = true;
  private resolved: ResolvedValue<GitHubReference> = { status: "loading" };

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
    const changed =
      node.attrs.raw !== this.node.attrs.raw ||
      node.attrs.number !== this.node.attrs.number ||
      node.attrs.owner !== this.node.attrs.owner ||
      node.attrs.repo !== this.node.attrs.repo;
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
    if (!options.referenceResolver) {
      this.resolved = { status: "missing" };
      this.render();
      return;
    }

    const ref: ReferenceToken = {
      owner: this.node.attrs.owner ?? undefined,
      repo: this.node.attrs.repo ?? undefined,
      number: Number(this.node.attrs.number),
      raw: this.node.attrs.raw,
    };

    this.resolved = { status: "loading" };
    this.render();

    try {
      const value = await options.referenceResolver.resolveReference(ref, options.context);
      if (!this.alive) return;
      this.resolved = value ? { status: "resolved", value } : { status: "missing" };
    } catch (error) {
      if (!this.alive) return;
      this.resolved = { status: "error", error };
    }
    this.render();
  }

  private render() {
    this.root.render(<ReferenceChip node={this.node} resolved={this.resolved} />);
  }
}

export function ReferenceChip({ node, resolved }: { node: ProseMirrorNode; resolved: ResolvedValue<GitHubReference> }) {
  const raw = node.attrs.raw ?? `#${node.attrs.number}`;
  const value = resolved.value;
  const label = value ? `${value.type === "pull" ? "PR" : "Issue"} #${value.number}` : raw;
  const state = value?.state ?? resolved.status;

  return (
    <span className="gfmd-reference" data-state={state} title={value?.title ?? raw}>
      <span className="gfmd-reference-label">{label}</span>
      {value?.title ? <span className="gfmd-reference-title">{value.title}</span> : null}
    </span>
  );
}
