import {
  AllSelection,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Selection,
} from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import {
  type FootnoteIndex,
  indexFootnotes,
  placeFootnoteDefinitionsAtDocumentEnd,
} from "./model";

interface FootnotePluginState {
  decorations: DecorationSet;
  index: FootnoteIndex;
}

const footnotePluginKey = new PluginKey<FootnotePluginState>("gfmd-footnotes");

export function createFootnotePlugin() {
  return new Plugin({
    key: footnotePluginKey,
    state: {
      init: (_config, state) => createPluginState(state.doc),
      apply: (transaction, value) =>
        transaction.docChanged ? createPluginState(transaction.doc) : value,
    },
    props: {
      decorations: (state) =>
        footnotePluginKey.getState(state)?.decorations ?? null,
    },
    appendTransaction: (transactions, _oldState, newState) => {
      if (!transactions.some((transaction) => transaction.docChanged)) {
        return null;
      }

      const orderedDoc = placeFootnoteDefinitionsAtDocumentEnd(newState.doc);
      if (orderedDoc === newState.doc) return null;

      const replaceFrom = sharedTopLevelPrefixSize(newState.doc, orderedDoc);
      const tr = newState.tr.replaceWith(
        replaceFrom,
        newState.doc.content.size,
        orderedDoc.content.cut(replaceFrom),
      );
      return tr.setSelection(
        remapSelectionForFootnoteOrder(
          newState.selection,
          newState.doc,
          tr.doc,
        ),
      );
    },
  });
}

export function footnoteIndexForState(state: EditorState) {
  return footnotePluginKey.getState(state)?.index ?? indexFootnotes(state.doc);
}

function createPluginState(doc: EditorState["doc"]): FootnotePluginState {
  const index = indexFootnotes(doc);
  const decorations: Decoration[] = [];

  for (const entry of index.entries.values()) {
    const referenceKey = entry.referencePositions.join(",");
    for (const pos of entry.definitionPositions) {
      const node = doc.nodeAt(pos);
      if (!node) continue;
      // Position changes must invalidate the definition node view even when
      // the definition node itself is unchanged.
      decorations.push(
        Decoration.node(
          pos,
          pos + node.nodeSize,
          {},
          { key: referenceKey },
        ),
      );
    }
  }

  return {
    index,
    decorations: DecorationSet.create(doc, decorations),
  };
}

function remapSelectionForFootnoteOrder(
  selection: Selection,
  oldDoc: EditorState["doc"],
  newDoc: EditorState["doc"],
) {
  if (selection instanceof AllSelection) return new AllSelection(newDoc);

  const anchor = remapTopLevelPosition(selection.anchor, oldDoc, newDoc);
  const head = remapTopLevelPosition(selection.head, oldDoc, newDoc);

  if (selection instanceof NodeSelection) {
    return NodeSelection.create(newDoc, anchor);
  }
  return TextSelection.create(newDoc, anchor, head);
}

function remapTopLevelPosition(
  pos: number,
  oldDoc: EditorState["doc"],
  newDoc: EditorState["doc"],
) {
  if (pos === oldDoc.content.size) return newDoc.content.size;

  let oldStart = 0;
  let selectedNode: EditorState["doc"] | null = null;
  let offset = 0;
  oldDoc.forEach((node) => {
    const oldEnd = oldStart + node.nodeSize;
    if (!selectedNode && pos >= oldStart && pos < oldEnd) {
      selectedNode = node;
      offset = pos - oldStart;
    }
    oldStart = oldEnd;
  });

  if (!selectedNode) return Math.min(pos, newDoc.content.size);

  let newStart = 0;
  for (let index = 0; index < newDoc.childCount; index += 1) {
    const node = newDoc.child(index);
    if (node === selectedNode) {
      return newStart + offset;
    }
    newStart += node.nodeSize;
  }
  return Math.min(pos, newDoc.content.size);
}

function sharedTopLevelPrefixSize(
  oldDoc: EditorState["doc"],
  newDoc: EditorState["doc"],
) {
  let size = 0;
  const childCount = Math.min(oldDoc.childCount, newDoc.childCount);

  for (let index = 0; index < childCount; index += 1) {
    const node = oldDoc.child(index);
    if (node !== newDoc.child(index)) break;
    size += node.nodeSize;
  }
  return size;
}
