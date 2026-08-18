import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
  NodeSelection,
  Plugin,
  TextSelection,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { isSafeInteractionHref } from "./link-url";
import { gfmSchema } from "./schema";

export interface LinkEdit {
  href: string;
  label: string | null;
  title: string;
}

interface LinkSelectionBase {
  from: number;
  to: number;
  href: string;
  title: string;
  originalAnchor: number;
  originalHead: number;
  nodeSelectionFrom: number | null;
}

export type LinkSelection =
  | (LinkSelectionBase & {
      kind: "empty-link";
      label: "";
      marks: readonly Mark[];
    })
  | (LinkSelectionBase & {
      kind: "existing";
      label: string | null;
    })
  | (LinkSelectionBase & {
      kind: "new";
      label: string | null;
    });

export function linkSelection(state: EditorState): LinkSelection | null {
  const { selection } = state;

  if (
    selection instanceof NodeSelection &&
    selection.node.type === gfmSchema.nodes.empty_link
  ) {
    return {
      from: selection.from,
      to: selection.to,
      href: String(selection.node.attrs.href),
      label: "",
      title: String(selection.node.attrs.title ?? ""),
      originalAnchor: selection.anchor,
      originalHead: selection.head,
      nodeSelectionFrom: selection.from,
      kind: "empty-link",
      marks: selection.node.marks,
    };
  }

  if (
    !(selection instanceof TextSelection) &&
    !(selection instanceof NodeSelection)
  ) {
    return null;
  }

  if (
    selection instanceof TextSelection &&
    !selection.$from.sameParent(selection.$to)
  ) {
    return null;
  }

  const range = activeLinkRange(state);
  if (range) {
    return {
      ...range,
      label: textLabel(state.doc, range.from, range.to),
      originalAnchor: selection.anchor,
      originalHead: selection.head,
      nodeSelectionFrom:
        selection instanceof NodeSelection ? selection.from : null,
      kind: "existing",
    };
  }

  if (!(selection instanceof TextSelection)) return null;

  return {
    from: selection.from,
    to: selection.to,
    href: "",
    label: textLabel(state.doc, selection.from, selection.to),
    title: "",
    originalAnchor: selection.anchor,
    originalHead: selection.head,
    nodeSelectionFrom: null,
    kind: "new",
  };
}

export function applyLinkEdit(
  state: EditorState,
  selection: LinkSelection,
  edit: LinkEdit,
) {
  const title = edit.title === "" ? null : edit.title;
  const linkMark = gfmSchema.marks.link.create({ href: edit.href, title });
  let tr = state.tr;

  if (edit.label === "" && selection.label !== null) {
    const marks =
      selection.kind === "empty-link" ? selection.marks : linkContentMarks(
        state,
        selection,
        selection.from,
      );
    tr = tr.replaceWith(
      selection.from,
      selection.to,
      gfmSchema.nodes.empty_link.create(
        { href: edit.href, title },
        undefined,
        marks,
      ),
    );
    return tr.setSelection(NodeSelection.create(tr.doc, selection.from));
  }

  if (selection.kind === "existing") {
    tr = tr.removeMark(selection.from, selection.to, gfmSchema.marks.link);
  }

  if (edit.label === null || selection.label === null) {
    tr = tr.addMark(selection.from, selection.to, linkMark);
    return tr.setSelection(selectionAfterUnchangedEdit(tr, selection));
  }

  if (selection.kind === "empty-link") {
    tr = tr.replaceWith(
      selection.from,
      selection.to,
      gfmSchema.text(edit.label, [
        ...selection.marks.filter((mark) => mark.type !== gfmSchema.marks.link),
        linkMark,
      ]),
    );
    return tr.setSelection(
      TextSelection.create(
        tr.doc,
        selection.from,
        selection.from + edit.label.length,
      ),
    );
  }

  const oldLabel = selection.label;
  const labelChanged = edit.label !== oldLabel;

  let linkTo = selection.to;
  if (labelChanged) {
    const { prefix, oldSuffix, newSuffix } = unchangedAffixes(
      oldLabel,
      edit.label,
    );
    const replaceFrom = selection.from + prefix;
    const replaceTo = selection.to - oldSuffix;
    const replacement = edit.label.slice(prefix, edit.label.length - newSuffix);
    const marks = linkContentMarks(state, selection, replaceFrom);

    tr = tr.replaceWith(
      replaceFrom,
      replaceTo,
      replacement ? gfmSchema.text(replacement, marks) : [],
    );
    linkTo = selection.from + edit.label.length;
  }

  tr = tr.addMark(selection.from, linkTo, linkMark);
  return tr.setSelection(selectionAfterEdit(tr, selection, linkTo));
}

export function removeLink(
  state: EditorState,
  selection: LinkSelection,
): Transaction {
  if (selection.kind === "empty-link") {
    const tr = state.tr.delete(selection.from, selection.to);
    return tr.setSelection(TextSelection.create(tr.doc, selection.from));
  }

  const tr = state.tr.removeMark(
    selection.from,
    selection.to,
    gfmSchema.marks.link,
  );
  return tr.setSelection(selectionAfterUnchangedEdit(tr, selection));
}

export function restoreLinkSelection(
  view: EditorView,
  selection: LinkSelection,
) {
  const maxPosition = view.state.doc.content.size;
  const anchor = Math.min(selection.originalAnchor, maxPosition);
  const head = Math.min(selection.originalHead, maxPosition);
  const nodeSelectionFrom = selection.nodeSelectionFrom;
  const selectedNode =
    nodeSelectionFrom === null
      ? null
      : selectableNodeAt(view.state.doc, nodeSelectionFrom);
  const restoredSelection =
    nodeSelectionFrom !== null && selectedNode
      ? NodeSelection.create(view.state.doc, nodeSelectionFrom)
      : TextSelection.create(view.state.doc, anchor, head);
  view.dispatch(
    view.state.tr.setSelection(restoredSelection),
  );
  view.focus();
}

export function openLink(href: string, open = globalThis.window?.open) {
  if (!isSafeInteractionHref(href) || !open) return false;
  open.call(globalThis.window, href, "_blank", "noopener,noreferrer");
  return true;
}

export function createLinkInteractionPlugin() {
  return new Plugin({
    props: {
      handleDOMEvents: {
        click: (_view, event) => {
          const target = event.target;
          if (
            !(target instanceof Element) ||
            !target.closest(
              "a[data-gfmd-link], a[data-gfmd-empty-link], a[data-gfmd-mention], a[data-gfmd-reference]",
            )
          ) {
            return false;
          }

          event.preventDefault();
          return true;
        },
      },
    },
  });
}

function activeLinkRange(state: EditorState) {
  const { $from, $to, empty } = state.selection;
  const parent = $from.parent;
  const parentStart = $from.start();
  const fromOffset = $from.parentOffset;

  const candidate = linkAtOffset(parent, fromOffset, true);
  if (!candidate) return null;

  let startIndex = candidate.index;
  let endIndex = candidate.index + 1;
  while (
    startIndex > 0 &&
    candidate.mark.isInSet(parent.child(startIndex - 1).marks)
  ) {
    startIndex -= 1;
  }
  while (
    endIndex < parent.childCount &&
    candidate.mark.isInSet(parent.child(endIndex).marks)
  ) {
    endIndex += 1;
  }

  let from = parentStart;
  for (let index = 0; index < startIndex; index += 1) {
    from += parent.child(index).nodeSize;
  }
  let to = from;
  for (let index = startIndex; index < endIndex; index += 1) {
    to += parent.child(index).nodeSize;
  }

  if (!empty && ($from.pos < from || $to.pos > to)) return null;
  return {
    from,
    to,
    href: String(candidate.mark.attrs.href),
    title: String(candidate.mark.attrs.title ?? ""),
  };
}

function linkAtOffset(
  parent: ProseMirrorNode,
  offset: number,
  allowStartBoundary: boolean,
): { index: number; mark: Mark } | null {
  const child = parent.childAfter(offset);
  if (child.node) {
    const inside = offset > child.offset || allowStartBoundary;
    const mark = inside ? gfmSchema.marks.link.isInSet(child.node.marks) : null;
    if (mark) return { index: child.index, mark };
  }

  const before = parent.childBefore(offset);
  if (
    before.node &&
    offset < before.offset + before.node.nodeSize &&
    gfmSchema.marks.link.isInSet(before.node.marks)
  ) {
    return {
      index: before.index,
      mark: gfmSchema.marks.link.isInSet(before.node.marks)!,
    };
  }

  return null;
}

function unchangedAffixes(oldLabel: string, newLabel: string) {
  let prefix = 0;
  while (
    prefix < oldLabel.length &&
    prefix < newLabel.length &&
    oldLabel[prefix] === newLabel[prefix]
  ) {
    prefix += 1;
  }

  let oldSuffix = 0;
  let newSuffix = 0;
  while (
    oldSuffix < oldLabel.length - prefix &&
    newSuffix < newLabel.length - prefix &&
    oldLabel[oldLabel.length - oldSuffix - 1] ===
      newLabel[newLabel.length - newSuffix - 1]
  ) {
    oldSuffix += 1;
    newSuffix += 1;
  }

  return { prefix, oldSuffix, newSuffix };
}

function textLabel(doc: ProseMirrorNode, from: number, to: number) {
  const label = doc.textBetween(from, to);
  return label.length === to - from ? label : null;
}

function linkContentMarks(
  state: EditorState,
  selection: LinkSelection,
  position: number,
) {
  if (selection.kind === "new") {
    return (state.storedMarks ?? state.doc.resolve(selection.from).marks()).filter(
      (mark) => mark.type !== gfmSchema.marks.link,
    );
  }

  const $position = state.doc.resolve(position);
  const nodeAfter = $position.nodeAfter;
  if (nodeAfter && position < selection.to) {
    return nodeAfter.marks.filter((mark) => mark.type !== gfmSchema.marks.link);
  }
  const nodeBefore = $position.nodeBefore;
  if (nodeBefore && position === selection.to) {
    return nodeBefore.marks.filter((mark) => mark.type !== gfmSchema.marks.link);
  }

  return [];
}

function selectionAfterUnchangedEdit(
  tr: Transaction,
  selection: LinkSelection,
) {
  const nodeSelectionFrom = selection.nodeSelectionFrom;
  const selectedNode =
    nodeSelectionFrom === null
      ? null
      : selectableNodeAt(tr.doc, nodeSelectionFrom);
  if (
    nodeSelectionFrom !== null &&
    selectedNode
  ) {
    return NodeSelection.create(tr.doc, nodeSelectionFrom);
  }
  return TextSelection.create(
    tr.doc,
    Math.min(selection.originalAnchor, selection.to),
    Math.min(selection.originalHead, selection.to),
  );
}

function selectableNodeAt(doc: ProseMirrorNode, position: number) {
  const node = doc.nodeAt(position);
  return node && NodeSelection.isSelectable(node) ? node : null;
}

function selectionAfterEdit(
  tr: Transaction,
  selection: LinkSelection,
  linkTo: number,
) {
  if (selection.originalAnchor !== selection.originalHead) {
    return TextSelection.create(tr.doc, selection.from, linkTo);
  }

  const relative = selection.originalHead - selection.from;
  const cursor = selection.from + Math.min(relative, linkTo - selection.from);
  return TextSelection.create(tr.doc, cursor);
}
