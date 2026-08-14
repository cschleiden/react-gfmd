import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import {
  type FootnoteIndex,
  indexFootnotes,
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
