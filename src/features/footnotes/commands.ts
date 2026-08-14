import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
  NodeSelection,
  TextSelection,
  type Command,
  type EditorState,
} from "prosemirror-state";
import { gfmSchema } from "../../schema";
import {
  type FootnoteIndex,
  footnoteEntry,
  indexFootnotes,
  normalizeFootnoteIdentifier,
} from "./model";

export const insertFootnote: Command = (state, dispatch) => {
  if (
    !(state.selection instanceof TextSelection) ||
    !state.selection.$to.parent.isTextblock
  ) {
    return false;
  }
  if (!dispatch) return true;

  const identifier = nextFootnoteIdentifier(state.doc);
  const reference = gfmSchema.nodes.footnote_reference.create({
    identifier,
    label: identifier,
  });
  const definition = gfmSchema.nodes.footnote_definition.create(
    { identifier, label: identifier },
    [gfmSchema.nodes.paragraph.create()],
  );
  let tr = state.tr.insert(state.selection.to, reference);
  const definitionPos = tr.doc.content.size;
  tr = tr.insert(definitionPos, definition);
  tr = tr.setSelection(TextSelection.near(tr.doc.resolve(definitionPos + 2)));
  dispatch(tr.scrollIntoView());
  return true;
};

export function insertFootnoteReference(identifier: string): Command {
  return (state, dispatch) => {
    if (
      !(state.selection instanceof TextSelection) ||
      !state.selection.$to.parent.isTextblock
    ) {
      return false;
    }

    const definition = footnoteEntry(indexFootnotes(state.doc), identifier);
    if (!definition?.definitionPositions.length) return false;
    if (!dispatch) return true;

    const reference = gfmSchema.nodes.footnote_reference.create({
      identifier: definition.identifier,
      label: definition.label,
    });
    const tr = state.tr.insert(state.selection.to, reference);
    dispatch(
      tr
        .setSelection(NodeSelection.create(tr.doc, state.selection.to))
        .scrollIntoView(),
    );
    return true;
  };
}

export function renameFootnote(
  identifier: string,
  label: string,
): Command {
  return (state, dispatch) => {
    const index = indexFootnotes(state.doc);
    const normalizedIdentifier = normalizeFootnoteIdentifier(label);
    if (footnoteRenameErrorForIndex(index, identifier, label)) {
      return false;
    }
    const entry = footnoteEntry(index, identifier);
    if (!dispatch) return Boolean(entry);

    const tr = state.tr;
    for (const pos of entry?.nodePositions ?? []) {
      const node = tr.doc.nodeAt(pos);
      if (!node) continue;
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        identifier: normalizedIdentifier,
        label: label.trim(),
      });
    }
    if (!tr.docChanged) return false;
    dispatch(tr);
    return true;
  };
}

export function selectedFootnoteIdentifier(
  state: EditorState,
): string | null {
  if (
    state.selection instanceof NodeSelection &&
    state.selection.node.type === gfmSchema.nodes.footnote_reference
  ) {
    return String(state.selection.node.attrs.identifier);
  }

  if (state.selection instanceof TextSelection) {
    const node = state.doc.nodeAt(state.selection.from);
    if (
      node?.type === gfmSchema.nodes.footnote_reference &&
      state.selection.to === state.selection.from + node.nodeSize
    ) {
      return String(node.attrs.identifier);
    }
  }

  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type === gfmSchema.nodes.footnote_definition) {
      return String(node.attrs.identifier);
    }
  }
  return null;
}

export function footnoteRenameError(
  doc: ProseMirrorNode,
  oldIdentifier: string,
  label: string,
) {
  return footnoteRenameErrorForIndex(
    indexFootnotes(doc),
    oldIdentifier,
    label,
  );
}

function footnoteRenameErrorForIndex(
  index: FootnoteIndex,
  oldIdentifier: string,
  label: string,
) {
  const identifier = normalizeFootnoteIdentifier(label);
  if (!identifier) return "Footnote labels cannot be empty.";
  if (/[\s[\]]/.test(label.trim())) {
    return "Use a single footnote label without spaces or brackets.";
  }
  const collision = footnoteEntry(index, identifier);
  if (
    collision &&
    normalizeFootnoteIdentifier(oldIdentifier) !== identifier
  ) {
    return `A different footnote already uses “${label.trim()}”.`;
  }
  return null;
}

function nextFootnoteIdentifier(doc: ProseMirrorNode) {
  const { occupiedIdentifiers } = indexFootnotes(doc);

  let candidate = 1;
  while (occupiedIdentifiers.has(String(candidate))) candidate += 1;
  return String(candidate);
}
