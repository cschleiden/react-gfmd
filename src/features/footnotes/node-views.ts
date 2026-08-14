import type { Node as ProseMirrorNode } from "prosemirror-model";
import { NodeSelection, TextSelection } from "prosemirror-state";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";
import {
  footnoteRenameError,
  renameFootnote,
} from "./commands";
import { footnoteEntry } from "./model";
import { footnoteIndexForState } from "./plugin";

export class FootnoteReferenceNodeView implements NodeView {
  dom: HTMLElement;
  private button: HTMLButtonElement;

  constructor(
    private node: ProseMirrorNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("sup");
    this.dom.className = "gfmd-footnote-reference";
    this.dom.dataset.gfmdFootnoteReference = "";
    this.dom.contentEditable = "false";
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "gfmd-footnote-reference-button";
    this.button.addEventListener("click", this.navigateToDefinition);
    this.dom.append(this.button);
    this.render();
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode() {
    this.dom.dataset.selected = "";
  }

  deselectNode() {
    delete this.dom.dataset.selected;
  }

  stopEvent(event: Event) {
    return event.target === this.button;
  }

  destroy() {
    this.button.removeEventListener("click", this.navigateToDefinition);
  }

  private navigateToDefinition = () => {
    const identifier = String(this.node.attrs.identifier);
    const definitionPos = footnoteEntry(
      footnoteIndexForState(this.view.state),
      identifier,
    )?.definitionPositions[0];
    if (definitionPos === undefined) {
      const pos = this.getPos();
      if (typeof pos === "number") {
        this.view.dispatch(
          this.view.state.tr.setSelection(
            NodeSelection.create(this.view.state.doc, pos),
          ),
        );
      }
      this.button.dataset.orphan = "";
      this.button.setAttribute(
        "aria-label",
        `Footnote ${displayLabel(this.node)} has no definition`,
      );
      return;
    }

    const tr = this.view.state.tr
      .setSelection(
        TextSelection.near(this.view.state.doc.resolve(definitionPos + 2)),
      )
      .scrollIntoView();
    this.view.dispatch(tr);
    const definitionDOM = this.view.nodeDOM(definitionPos);
    const labelInput =
      definitionDOM instanceof HTMLElement
        ? definitionDOM.querySelector<HTMLInputElement>(".gfmd-footnote-label")
        : null;
    (labelInput ?? this.view.dom).focus();
  };

  private render() {
    const label = displayLabel(this.node);
    this.dom.dataset.identifier = String(this.node.attrs.identifier);
    this.button.textContent = label;
    this.button.setAttribute(
      "aria-label",
      `Footnote ${label}; go to definition`,
    );
    this.button.title = `Go to footnote ${label}`;
    delete this.button.dataset.orphan;
  }
}

export class FootnoteDefinitionNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private header: HTMLElement;
  private labelInput: HTMLInputElement;
  private backReferences: HTMLElement;
  private status: HTMLElement;

  constructor(
    private node: ProseMirrorNode,
    private view: EditorView,
  ) {
    this.dom = document.createElement("section");
    this.dom.className = "gfmd-footnote-definition";
    this.dom.dataset.gfmdFootnoteDefinition = "";

    this.header = document.createElement("header");
    this.header.className = "gfmd-footnote-definition-header";
    this.header.contentEditable = "false";

    const marker = document.createElement("span");
    marker.className = "gfmd-footnote-definition-marker";
    marker.textContent = "Footnote";

    this.labelInput = document.createElement("input");
    this.labelInput.className = "gfmd-footnote-label";
    this.labelInput.type = "text";
    this.labelInput.spellcheck = false;
    this.labelInput.addEventListener("change", this.commitLabel);
    this.labelInput.addEventListener("keydown", this.handleLabelKeyDown);

    this.backReferences = document.createElement("nav");
    this.backReferences.className = "gfmd-footnote-backreferences";

    this.status = document.createElement("span");
    this.status.className = "gfmd-visually-hidden";
    this.status.setAttribute("aria-live", "polite");

    this.header.append(marker, this.labelInput, this.backReferences, this.status);
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "gfmd-footnote-definition-content";
    this.dom.append(this.header, this.contentDOM);
    this.render();
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event) {
    return this.header.contains(event.target as Node);
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return this.header.contains(mutation.target);
  }

  destroy() {
    this.labelInput.removeEventListener("change", this.commitLabel);
    this.labelInput.removeEventListener("keydown", this.handleLabelKeyDown);
  }

  private commitLabel = () => {
    const identifier = String(this.node.attrs.identifier);
    const label = this.labelInput.value;
    const error = footnoteRenameError(this.view.state.doc, identifier, label);
    this.labelInput.setCustomValidity(error ?? "");
    if (error) {
      this.status.textContent = error;
      this.labelInput.reportValidity();
      return;
    }

    const command = renameFootnote(identifier, label);
    if (command(this.view.state, this.view.dispatch, this.view)) {
      this.status.textContent = `Renamed footnote to ${label.trim()}.`;
    }
  };

  private handleLabelKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      this.commitLabel();
      this.view.focus();
    } else if (event.key === "Escape") {
      this.labelInput.value = displayLabel(this.node);
      this.labelInput.setCustomValidity("");
      this.status.textContent = "";
      this.view.focus();
    }
  };

  private navigateToReference(referencePos: number) {
    this.view.dispatch(
      this.view.state.tr.setSelection(
        TextSelection.create(
          this.view.state.doc,
          referencePos,
          referencePos + 1,
        ),
      ),
    );
    this.view.focus();
    const referenceDOM = this.view.nodeDOM(referencePos);
    if (
      referenceDOM instanceof HTMLElement &&
      typeof referenceDOM.scrollIntoView === "function"
    ) {
      referenceDOM.scrollIntoView({ block: "nearest" });
    }
  }

  private render() {
    const label = displayLabel(this.node);
    const referencePositions =
      footnoteEntry(
        footnoteIndexForState(this.view.state),
        String(this.node.attrs.identifier),
      )?.referencePositions ?? [];
    this.dom.dataset.identifier = String(this.node.attrs.identifier);
    this.dom.setAttribute("aria-label", `Footnote ${label} definition`);
    if (document.activeElement !== this.labelInput) {
      this.labelInput.value = label;
    }
    this.labelInput.setAttribute("aria-label", `Footnote ${label} label`);
    this.labelInput.title = "Edit footnote label";
    this.renderBackReferences(label, referencePositions);
  }

  private renderBackReferences(label: string, positions: readonly number[]) {
    this.backReferences.replaceChildren();
    this.backReferences.setAttribute(
      "aria-label",
      `References to footnote ${label}`,
    );

    const heading = document.createElement("span");
    heading.className = "gfmd-footnote-backreferences-label";
    heading.textContent = positions.length ? "Refs" : "No refs";
    this.backReferences.append(heading);

    positions.forEach((pos, index) => {
      const ordinal = index + 1;
      const button = document.createElement("button");
      button.className = "gfmd-footnote-backreference";
      button.type = "button";
      button.textContent = String(ordinal);
      button.title = `Go to reference ${ordinal}`;
      button.setAttribute(
        "aria-label",
        `Go to reference ${ordinal} of ${positions.length} for footnote ${label}`,
      );
      button.addEventListener("click", () => this.navigateToReference(pos));
      this.backReferences.append(button);
    });
  }
}

function displayLabel(node: ProseMirrorNode) {
  return String(node.attrs.label ?? node.attrs.identifier);
}
