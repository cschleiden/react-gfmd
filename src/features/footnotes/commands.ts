import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
  NodeSelection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { gfmSchema } from "../../schema";

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

export function renameFootnote(
  identifier: string,
  label: string,
): Command {
  return (state, dispatch) => {
    const normalizedIdentifier = normalizeFootnoteIdentifier(label);
    if (footnoteRenameError(state.doc, identifier, label)) {
      return false;
    }
    if (!dispatch) return hasMatchingFootnote(state.doc, identifier);

    const tr = renameMatchingFootnotes(
      state.tr,
      identifier,
      normalizedIdentifier,
      label.trim(),
    );
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

  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type === gfmSchema.nodes.footnote_definition) {
      return String(node.attrs.identifier);
    }
  }
  return null;
}

export function footnoteLabelForIdentifier(
  doc: ProseMirrorNode,
  identifier: string,
) {
  let label = identifier;
  doc.descendants((node) => {
    if (
      isFootnoteNode(node) &&
      sameIdentifier(node.attrs.identifier, identifier)
    ) {
      label = String(node.attrs.label ?? node.attrs.identifier);
      return false;
    }
    return true;
  });
  return label;
}

export function footnoteRenameError(
  doc: ProseMirrorNode,
  oldIdentifier: string,
  label: string,
) {
  const identifier = normalizeFootnoteIdentifier(label);
  if (!identifier) return "Footnote labels cannot be empty.";
  if (/[\s[\]]/.test(label.trim())) {
    return "Use a single footnote label without spaces or brackets.";
  }
  if (hasFootnoteCollision(doc, oldIdentifier, identifier)) {
    return `A different footnote already uses “${label.trim()}”.`;
  }
  return null;
}

export function normalizeFootnoteIdentifier(label: string) {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function nextFootnoteIdentifier(doc: ProseMirrorNode) {
  const identifiers = new Set<string>();
  doc.descendants((node) => {
    if (isFootnoteNode(node)) {
      identifiers.add(normalizeFootnoteIdentifier(String(node.attrs.identifier)));
      identifiers.add(
        normalizeFootnoteIdentifier(
          String(node.attrs.label ?? node.attrs.identifier),
        ),
      );
    }
  });

  let candidate = 1;
  while (identifiers.has(String(candidate))) candidate += 1;
  return String(candidate);
}

function hasMatchingFootnote(doc: ProseMirrorNode, identifier: string) {
  let found = false;
  doc.descendants((node) => {
    if (isFootnoteNode(node) && sameIdentifier(node.attrs.identifier, identifier)) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

function hasFootnoteCollision(
  doc: ProseMirrorNode,
  oldIdentifier: string,
  newIdentifier: string,
) {
  let collision = false;
  doc.descendants((node) => {
    if (
      isFootnoteNode(node) &&
      !sameIdentifier(node.attrs.identifier, oldIdentifier) &&
      sameIdentifier(node.attrs.identifier, newIdentifier)
    ) {
      collision = true;
      return false;
    }
    return true;
  });
  return collision;
}

function renameMatchingFootnotes(
  tr: Transaction,
  oldIdentifier: string,
  identifier: string,
  label: string,
) {
  const positions: number[] = [];
  tr.doc.descendants((node, pos) => {
    if (
      isFootnoteNode(node) &&
      sameIdentifier(node.attrs.identifier, oldIdentifier)
    ) {
      positions.push(pos);
    }
  });

  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos);
    if (!node) continue;
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      identifier,
      label,
    });
  }
  return tr;
}

function isFootnoteNode(node: ProseMirrorNode) {
  return (
    node.type === gfmSchema.nodes.footnote_reference ||
    node.type === gfmSchema.nodes.footnote_definition
  );
}

function sameIdentifier(left: unknown, right: unknown) {
  return (
    normalizeFootnoteIdentifier(String(left)) ===
    normalizeFootnoteIdentifier(String(right))
  );
}
