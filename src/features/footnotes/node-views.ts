import type { Node as ProseMirrorNode } from "prosemirror-model";
import { NodeSelection, TextSelection } from "prosemirror-state";
import type {
  EditorView,
  NodeView,
  ViewMutationRecord,
} from "prosemirror-view";
import { runIsolatedCommand } from "../../history";
import {
  footnoteRenameError,
  renameFootnote,
} from "./commands";
import { footnoteDefinitionOrdinal, footnoteEntry } from "./model";
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
    if (definitionDOM instanceof HTMLElement) {
      definitionDOM.focus({ preventScroll: true });
    } else {
      this.view.focus();
    }
  };

  private render() {
    const label = displayLabel(this.node);
    const index = footnoteIndexForState(this.view.state);
    const ordinal = footnoteDefinitionOrdinal(
      index,
      String(this.node.attrs.identifier),
    );
    this.dom.dataset.identifier = String(this.node.attrs.identifier);
    this.button.textContent = ordinal ? String(ordinal) : label;
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
  private controls: HTMLElement;
  private marker: HTMLElement;
  private editLabelButton: HTMLButtonElement;
  private labelInput: HTMLInputElement;
  private status: HTMLElement;

  constructor(
    private node: ProseMirrorNode,
    private view: EditorView,
  ) {
    this.dom = document.createElement("section");
    this.dom.className = "gfmd-footnote-definition";
    this.dom.dataset.gfmdFootnoteDefinition = "";
    this.dom.tabIndex = -1;

    this.marker = document.createElement("span");
    this.marker.className = "gfmd-footnote-definition-marker";
    this.marker.setAttribute("aria-hidden", "true");

    this.controls = document.createElement("div");
    this.controls.className = "gfmd-footnote-definition-controls";
    this.controls.contentEditable = "false";

    this.editLabelButton = document.createElement("button");
    this.editLabelButton.className = "gfmd-footnote-edit-label";
    this.editLabelButton.type = "button";
    this.editLabelButton.addEventListener("click", this.beginLabelEdit);

    this.labelInput = document.createElement("input");
    this.labelInput.className = "gfmd-footnote-label";
    this.labelInput.type = "text";
    this.labelInput.spellcheck = false;
    this.labelInput.hidden = true;
    this.labelInput.addEventListener("change", this.commitLabel);
    this.labelInput.addEventListener("blur", this.handleLabelBlur);
    this.labelInput.addEventListener("keydown", this.handleLabelKeyDown);

    this.status = document.createElement("span");
    this.status.className = "gfmd-visually-hidden";
    this.status.setAttribute("aria-live", "polite");

    this.controls.append(
      this.marker,
      this.editLabelButton,
      this.labelInput,
      this.status,
    );
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "gfmd-footnote-definition-content";
    this.dom.append(this.controls, this.contentDOM);
    this.render();
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event) {
    return this.controls.contains(event.target as Node);
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    return this.controls.contains(mutation.target);
  }

  destroy() {
    this.editLabelButton.removeEventListener("click", this.beginLabelEdit);
    this.labelInput.removeEventListener("change", this.commitLabel);
    this.labelInput.removeEventListener("blur", this.handleLabelBlur);
    this.labelInput.removeEventListener("keydown", this.handleLabelKeyDown);
  }

  private beginLabelEdit = () => {
    this.dom.dataset.editing = "";
    this.editLabelButton.hidden = true;
    this.labelInput.hidden = false;
    this.labelInput.value = displayLabel(this.node);
    this.labelInput.setCustomValidity("");
    requestAnimationFrame(() => {
      if (this.labelInput.hidden) return;
      this.labelInput.focus();
      this.labelInput.select();
    });
  };

  private commitLabel = () => {
    const identifier = String(this.node.attrs.identifier);
    const label = this.labelInput.value;
    const error = footnoteRenameError(this.view.state.doc, identifier, label);
    this.labelInput.setCustomValidity(error ?? "");
    if (error) {
      this.status.textContent = error;
      this.labelInput.reportValidity();
      return false;
    }

    const command = renameFootnote(identifier, label);
    if (runIsolatedCommand(this.view, command, { focus: false })) {
      this.status.textContent = `Renamed footnote to ${label.trim()}.`;
      this.finishLabelEdit();
      return true;
    }
    return false;
  };

  private handleLabelBlur = () => {
    if (this.labelInput.validity.valid) this.finishLabelEdit();
  };

  private handleLabelKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (this.commitLabel()) this.view.focus();
    } else if (event.key === "Escape") {
      this.labelInput.value = displayLabel(this.node);
      this.labelInput.setCustomValidity("");
      this.status.textContent = "";
      this.finishLabelEdit(true);
    }
  };

  private finishLabelEdit(restoreFocus = false) {
    delete this.dom.dataset.editing;
    this.labelInput.hidden = true;
    this.editLabelButton.hidden = false;
    if (restoreFocus) this.editLabelButton.focus();
  }

  private render() {
    const label = displayLabel(this.node);
    const index = footnoteIndexForState(this.view.state);
    const identifier = String(this.node.attrs.identifier);
    const ordinal = footnoteDefinitionOrdinal(index, identifier);
    this.dom.dataset.identifier = String(this.node.attrs.identifier);
    this.dom.setAttribute("aria-label", `Footnote ${label} definition`);
    this.marker.textContent = ordinal ? `${ordinal}.` : "\u2022";
    if (document.activeElement !== this.labelInput) {
      this.labelInput.value = label;
    }
    this.labelInput.setAttribute("aria-label", `Footnote ${label} label`);
    this.labelInput.title = "Edit footnote label";
    this.editLabelButton.textContent = label;
    this.editLabelButton.setAttribute(
      "aria-label",
      `Edit footnote ${label} label`,
    );
    this.editLabelButton.title = `Edit Markdown label [^${label}]`;
  }
}

function displayLabel(node: ProseMirrorNode) {
  return String(node.attrs.label ?? node.attrs.identifier);
}
