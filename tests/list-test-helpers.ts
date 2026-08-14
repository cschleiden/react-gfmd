import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
  type Command,
  type EditorState,
  TextSelection,
  type Transaction,
} from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { expect } from "vitest";
import { gfmSchema } from "../src/schema";

export const context = { owner: "cschleiden", repo: "react-gfmd" };

export function withSelection(
  state: EditorState,
  from: number,
  to = from,
) {
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, from, to)),
  );
}

export function runCommand(state: EditorState, command: Command) {
  let current = state;
  const view = {
    get state() {
      return current;
    },
    dispatch(transaction: Transaction) {
      current = current.apply(transaction);
    },
  } as unknown as EditorView;

  expect(command(current, view.dispatch.bind(view), view)).toBe(true);
  return current;
}

export function runKey(state: EditorState, keyName: string) {
  let current = state;
  const view = {
    get state() {
      return current;
    },
    dispatch(transaction: Transaction) {
      current = current.apply(transaction);
    },
    endOfTextblock() {
      return current.selection.$from.parentOffset === 0;
    },
  } as unknown as EditorView;

  for (const plugin of current.plugins) {
    const handler = plugin.props.handleKeyDown;
    if (
      handler?.call(
        plugin,
        view,
        new KeyboardEvent("keydown", { key: keyName }),
      )
    ) {
      break;
    }
  }

  return current;
}

export function findTextPosition(state: EditorState, text: string) {
  let found = -1;
  state.doc.descendants((node, pos) => {
    const offset = node.isText ? node.text?.indexOf(text) ?? -1 : -1;
    if (offset >= 0) {
      found = pos + offset;
      return false;
    }
    return true;
  });
  expect(found).toBeGreaterThanOrEqual(0);
  return found;
}

export function nearestList(state: EditorState, text: string) {
  const $pos = state.doc.resolve(findTextPosition(state, text));
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (
      node.type === gfmSchema.nodes.bullet_list ||
      node.type === gfmSchema.nodes.ordered_list
    ) {
      return node;
    }
  }
  return undefined;
}

export function createEditorView(state: EditorState) {
  const mount = document.createElement("div");
  let view: EditorView;
  view = new EditorView(mount, {
    state,
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction));
    },
  });
  return view;
}

export function findNode(doc: ProseMirrorNode, type: string) {
  let found: ProseMirrorNode | undefined;
  doc.descendants((node) => {
    if (node.type.name === type) {
      found = node;
      return false;
    }
    return true;
  });
  return found;
}

export function pasteEvent() {
  return new Event("paste") as ClipboardEvent;
}
