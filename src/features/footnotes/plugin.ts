import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
  AllSelection,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Selection,
} from "prosemirror-state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
} from "prosemirror-view";
import {
  type FootnoteIndex,
  footnoteDefinitionOrdinal,
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
    const definitionKey =
      footnoteDefinitionOrdinal(index, entry.identifier)?.toString() ??
      "orphan";
    const referenceKey =
      `${definitionKey}:${entry.referencePositions.join(",")}`;
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

      if (entry.referencePositions.length) {
        const anchor = backreferenceAnchor(pos, node);
        decorations.push(
          Decoration.widget(
            anchor.pos,
            (view) =>
              createBackreferences(
                view,
                entry.label,
                entry.referencePositions,
                anchor.inline,
              ),
            {
              key: `backrefs:${referenceKey}:${entry.label}`,
              side: 1,
              ignoreSelection: true,
              stopEvent: () => true,
            },
          ),
        );
      }
    }

    for (const pos of entry.referencePositions) {
      const node = doc.nodeAt(pos);
      if (!node) continue;
      decorations.push(
        Decoration.node(
          pos,
          pos + node.nodeSize,
          {},
          { key: definitionKey },
        ),
      );
    }
  }

  return {
    index,
    decorations: DecorationSet.create(doc, decorations),
  };
}

export function navigateToFootnoteReference(
  view: EditorView,
  referencePos: number,
) {
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(
        view.state.doc,
        referencePos,
        referencePos + 1,
      ),
    ),
  );
  const referenceDOM = view.nodeDOM(referencePos);
  if (referenceDOM instanceof HTMLElement) {
    const referenceButton =
      referenceDOM.querySelector<HTMLButtonElement>(
        ".gfmd-footnote-reference-button",
      );
    referenceButton?.focus({ preventScroll: true });
    if (typeof referenceDOM.scrollIntoView === "function") {
      referenceDOM.scrollIntoView({ block: "nearest" });
    }
  } else {
    view.focus();
  }
}

function backreferenceAnchor(definitionPos: number, node: ProseMirrorNode) {
  let paragraphEnd: number | null = null;
  node.descendants((descendant, relativePos) => {
    if (descendant.type.name === "paragraph") {
      paragraphEnd =
        definitionPos + relativePos + descendant.content.size + 2;
    }
    return true;
  });

  return paragraphEnd === null
    ? { inline: false, pos: definitionPos + node.nodeSize - 1 }
    : { inline: true, pos: paragraphEnd };
}

function createBackreferences(
  view: EditorView,
  label: string,
  positions: readonly number[],
  inline: boolean,
) {
  const container = document.createElement(inline ? "span" : "div");
  container.className = "gfmd-footnote-backreferences";
  container.dataset.footnoteBackref = "";
  if (!inline) container.dataset.block = "";
  container.setAttribute("role", "navigation");
  container.setAttribute("aria-label", `References to footnote ${label}`);

  const heading = document.createElement("span");
  heading.className = "gfmd-footnote-backreferences-label";
  heading.textContent = "Back to references";
  container.append(heading);

  positions.forEach((pos, index) => {
    const ordinal = index + 1;
    const button = document.createElement("button");
    button.className = "gfmd-footnote-backreference";
    button.type = "button";
    button.textContent = `\u21a9${ordinal > 1 ? ordinal : ""}`;
    button.title = `Go to reference ${ordinal}`;
    button.setAttribute(
      "aria-label",
      `Go to reference ${ordinal} of ${positions.length} for footnote ${label}`,
    );
    button.addEventListener("click", () =>
      navigateToFootnoteReference(view, pos),
    );
    container.append(button);
  });

  return container;
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
