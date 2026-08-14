import type { Node as ProseMirrorNode, NodeType } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { gfmSchema } from "../schema";

export function isListType(type: NodeType) {
  return (
    type === gfmSchema.nodes.bullet_list || type === gfmSchema.nodes.ordered_list
  );
}

export function isListItemType(type: NodeType) {
  return (
    type === gfmSchema.nodes.list_item || type === gfmSchema.nodes.task_list_item
  );
}

export function isListNode(node: ProseMirrorNode) {
  return isListType(node.type);
}

export function isListItemNode(node: ProseMirrorNode) {
  return isListItemType(node.type);
}

export function currentListContainerContext(state: EditorState) {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (isListNode(node)) {
      const pos = $from.before(depth);
      if (state.selection.to > pos + node.nodeSize) continue;

      return {
        depth,
        node,
        pos,
        parentDepth: depth - 1,
        parent: $from.node(depth - 1),
        index: $from.index(depth - 1),
        parentPos: depth - 1 > 0 ? $from.before(depth - 1) : 0,
      };
    }
  }

  return null;
}

export function currentListItemContext(state: EditorState) {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (!isListItemNode(node)) continue;

    const parent = $from.node(depth - 1);
    return {
      depth,
      node,
      pos: $from.before(depth),
      parent,
      parentDepth: depth - 1,
      parentPos: depth - 1 > 0 ? $from.before(depth - 1) : 0,
    };
  }

  return null;
}

export function currentListItem(state: EditorState, type: NodeType) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type === type) return node;
  }
  return undefined;
}

export function isInAnyListItem(state: EditorState) {
  return Boolean(
    currentListItem(state, gfmSchema.nodes.list_item) ||
      currentListItem(state, gfmSchema.nodes.task_list_item),
  );
}

export function selectedListItemPositions(state: EditorState) {
  const positions = new Set<number>();
  const { from, to, $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (isListItemType($from.node(depth).type)) {
      positions.add($from.before(depth));
    }
  }

  state.doc.nodesBetween(from, to, (node, pos) => {
    if (isListItemNode(node)) {
      positions.add(pos);
      return false;
    }
    return true;
  });

  return [...positions].sort((a, b) => a - b);
}
