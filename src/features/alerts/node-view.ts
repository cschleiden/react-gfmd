import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import { alertKinds } from "./markdown";

export class AlertNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private select: HTMLSelectElement;

  constructor(
    private node: ProseMirrorNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("section");
    this.dom.className = `gfmd-alert gfmd-alert-${String(node.attrs.kind).toLowerCase()}`;
    this.dom.dataset.gfmdAlert = "";

    const header = document.createElement("div");
    header.className = "gfmd-alert-header";

    this.select = document.createElement("select");
    this.select.className = "gfmd-alert-kind";
    for (const kind of alertKinds) {
      const option = document.createElement("option");
      option.value = kind;
      option.textContent = kind;
      this.select.append(option);
    }
    this.select.value = node.attrs.kind;
    this.syncSelectWidth();
    this.select.addEventListener("change", this.updateKind);
    header.append(this.select);

    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "gfmd-alert-body";

    this.dom.append(header, this.contentDOM);
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.select.value = node.attrs.kind;
    this.syncSelectWidth();
    this.dom.className = `gfmd-alert gfmd-alert-${String(node.attrs.kind).toLowerCase()}`;
    return true;
  }

  destroy() {
    this.select.removeEventListener("change", this.updateKind);
  }

  private updateKind = () => {
    const pos = this.getPos();
    if (typeof pos !== "number") return;
    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        kind: this.select.value,
      }),
    );
    this.syncSelectWidth();
  };

  private syncSelectWidth() {
    this.select.style.width = `${this.select.value.length + 2.5}ch`;
  }
}
