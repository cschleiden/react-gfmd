import { wrapIn } from "prosemirror-commands";
import type { ResolvedPos } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import { gfmSchema } from "../../schema";
import type { AlertKind } from "./model";

export function setAlert(kind: AlertKind): Command {
  return (state, dispatch, view) => {
    const fromAncestor = alertOrBlockquoteAncestor(state.selection.$from);
    const toAncestor = alertOrBlockquoteAncestor(state.selection.$to);
    if (fromAncestor || toAncestor) {
      if (!fromAncestor || fromAncestor.pos !== toAncestor?.pos) return false;
      if (!dispatch) return true;
      dispatch(
        state.tr
          .setNodeMarkup(fromAncestor.pos, gfmSchema.nodes.alert, { kind })
          .scrollIntoView(),
      );
      return true;
    }

    return wrapIn(gfmSchema.nodes.alert, { kind })(state, dispatch, view);
  };
}

export function currentAlertKind(state: EditorState): AlertKind | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type === gfmSchema.nodes.alert) {
      return node.attrs.kind as AlertKind;
    }
  }
  return null;
}

function alertOrBlockquoteAncestor($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (
      node.type === gfmSchema.nodes.alert ||
      node.type === gfmSchema.nodes.blockquote
    ) {
      return { pos: $pos.before(depth) };
    }
  }
  return null;
}
