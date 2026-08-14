import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import {
  NodeSelection,
  TextSelection,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { gfmSchema } from "./schema";

export interface LinkEdit {
  href: string;
  label: string;
  title: string;
}

export interface LinkSelection {
  from: number;
  to: number;
  href: string;
  label: string;
  title: string;
  originalAnchor: number;
  originalHead: number;
  empty: boolean;
  existing: boolean;
}

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
      empty: true,
      existing: true,
    };
  }

  if (!(selection instanceof TextSelection)) {
    return null;
  }

  if (!selection.$from.sameParent(selection.$to)) {
    return null;
  }

  const range = activeLinkRange(state);
  if (range) {
    return {
      ...range,
      label: state.doc.textBetween(range.from, range.to),
      originalAnchor: selection.anchor,
      originalHead: selection.head,
      empty: false,
      existing: true,
    };
  }

  return {
    from: selection.from,
    to: selection.to,
    href: "",
    label: selection.empty
      ? ""
      : state.doc.textBetween(selection.from, selection.to),
    title: "",
    originalAnchor: selection.anchor,
    originalHead: selection.head,
    empty: false,
    existing: false,
  };
}

export function isLinkActive(state: EditorState) {
  return Boolean(activeLinkRange(state)) ||
    (state.selection instanceof NodeSelection &&
      state.selection.node.type === gfmSchema.nodes.empty_link);
}

export function applyLinkEdit(
  state: EditorState,
  selection: LinkSelection,
  edit: LinkEdit,
) {
  const title = edit.title === "" ? null : edit.title;
  const linkMark = gfmSchema.marks.link.create({ href: edit.href, title });
  let tr = state.tr;

  if (selection.empty) {
    if (edit.label === "") {
      tr = tr.setNodeMarkup(selection.from, gfmSchema.nodes.empty_link, {
        href: edit.href,
        title,
      });
      return tr.setSelection(NodeSelection.create(tr.doc, selection.from));
    }

    tr = tr.replaceWith(
      selection.from,
      selection.to,
      gfmSchema.text(edit.label, [linkMark]),
    );
    return tr.setSelection(
      TextSelection.create(
        tr.doc,
        selection.from,
        selection.from + edit.label.length,
      ),
    );
  }

  if (!selection.existing && edit.label === "") {
    tr = tr.replaceSelectionWith(
      gfmSchema.nodes.empty_link.create({ href: edit.href, title }),
    );
    return tr.setSelection(NodeSelection.create(tr.doc, selection.from));
  }

  if (selection.existing && edit.label === "") {
    tr = tr.replaceWith(
      selection.from,
      selection.to,
      gfmSchema.nodes.empty_link.create({ href: edit.href, title }),
    );
    return tr.setSelection(NodeSelection.create(tr.doc, selection.from));
  }

  const oldLabel = selection.label;
  const labelChanged = edit.label !== oldLabel;
  tr = tr.removeMark(selection.from, selection.to, gfmSchema.marks.link);

  let linkTo = selection.to;
  if (labelChanged) {
    const { prefix, oldSuffix, newSuffix } = unchangedAffixes(
      oldLabel,
      edit.label,
    );
    const replaceFrom = selection.from + prefix;
    const replaceTo = selection.to - oldSuffix;
    const replacement = edit.label.slice(prefix, edit.label.length - newSuffix);
    const marks = insertionMarks(state.doc, replaceFrom);

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
  if (selection.empty) {
    const tr = state.tr.delete(selection.from, selection.to);
    return tr.setSelection(TextSelection.create(tr.doc, selection.from));
  }

  const tr = state.tr.removeMark(
    selection.from,
    selection.to,
    gfmSchema.marks.link,
  );
  return tr.setSelection(
    TextSelection.create(
      tr.doc,
      Math.min(selection.originalAnchor, selection.to),
      Math.min(selection.originalHead, selection.to),
    ),
  );
}

export function restoreLinkSelection(
  view: EditorView,
  selection: LinkSelection,
) {
  const maxPosition = view.state.doc.content.size;
  const anchor = Math.min(selection.originalAnchor, maxPosition);
  const head = Math.min(selection.originalHead, maxPosition);
  const restoredSelection =
    selection.empty && view.state.doc.nodeAt(selection.from)?.type ===
      gfmSchema.nodes.empty_link
      ? NodeSelection.create(view.state.doc, selection.from)
      : TextSelection.create(view.state.doc, anchor, head);
  view.dispatch(
    view.state.tr.setSelection(restoredSelection),
  );
  view.focus();
}

export function openLink(href: string, open = globalThis.window?.open) {
  if (!isSafeOpenHref(href) || !open) return false;
  open.call(globalThis.window, href, "_blank", "noopener,noreferrer");
  return true;
}

export function isSafeOpenHref(href: string) {
  const normalized = href.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!normalized) return false;

  const scheme = normalized.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  return scheme !== "javascript" && scheme !== "data" && scheme !== "vbscript";
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

function insertionMarks(doc: ProseMirrorNode, position: number) {
  const $position = doc.resolve(position);
  const marks = $position.marks().filter((mark) => mark.type !== gfmSchema.marks.link);
  return marks;
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
