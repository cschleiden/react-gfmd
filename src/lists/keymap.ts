import { chainCommands, joinBackward } from "prosemirror-commands";
import { liftListItem, splitListItem } from "prosemirror-schema-list";
import type { Command, Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { gfmSchema } from "../schema";
import { changeListIndent } from "./indent";
import { isListItemNode, isListItemType, isListNode } from "./utils";

export function splitCurrentListItem(): Command {
  return chainCommands(
    outdentEmptyNestedListItem(),
    splitTaskListItem(),
    splitListItem(gfmSchema.nodes.list_item),
  );
}

function splitTaskListItem(): Command {
  const split = splitListItem(gfmSchema.nodes.task_list_item, {
    checked: false,
    spread: false,
  });

  return (state, dispatch) =>
    split(
      state,
      dispatch
        ? (transaction) => dispatch(resetCurrentTask(transaction))
        : undefined,
    );
}

function resetCurrentTask(transaction: Transaction) {
  const { $from } = transaction.selection;
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type !== gfmSchema.nodes.task_list_item) continue;

    return transaction.setNodeMarkup(
      $from.before(depth),
      gfmSchema.nodes.task_list_item,
      {
        ...node.attrs,
        checked: false,
      },
    );
  }

  return transaction;
}

function outdentEmptyNestedListItem(): Command {
  return (state, dispatch, view) => {
    const { empty, $from } = state.selection;
    if (
      !empty ||
      !$from.parent.isTextblock ||
      $from.parent.content.size !== 0 ||
      !hasNestedListItemParent($from)
    ) {
      return false;
    }

    return changeListIndent("outdent")(state, dispatch, view);
  };
}

export function outdentNestedListItemAtStart(): Command {
  return (state, dispatch, view) => {
    const { empty, $from } = state.selection;
    if (
      !empty ||
      $from.parent.type !== gfmSchema.nodes.paragraph ||
      $from.parentOffset !== 0
    ) {
      return false;
    }

    const itemDepth = nearestListItemDepth($from);
    if (itemDepth < 0 || $from.index(itemDepth) !== 0) {
      return false;
    }

    const item = $from.node(itemDepth);
    const itemIndex = $from.index(itemDepth - 1);
    const nested =
      itemDepth >= 3 && isListItemType($from.node(itemDepth - 2).type);

    if (itemIndex === 0) {
      if (nested) {
        return changeListIndent("outdent")(state, dispatch, view);
      }
      if (
        item.type === gfmSchema.nodes.task_list_item &&
        item.attrs.checked !== null
      ) {
        return true;
      }
      if (item.firstChild?.content.size === 0) return true;
      if (item.childCount > 1) return true;
      return liftTopLevelListItem(state, dispatch, item.type, itemDepth);
    }

    function liftTopLevelListItem(
      state: Parameters<Command>[0],
      dispatch: Parameters<Command>[1],
      itemType: import("prosemirror-model").NodeType,
      itemDepth: number,
    ) {
      const list = state.selection.$from.node(itemDepth - 1);
      const lift = liftListItem(itemType);
      if (list.type !== gfmSchema.nodes.ordered_list || !dispatch) {
        return lift(state, dispatch);
      }

      return lift(state, (transaction) => {
        const { $from } = transaction.selection;
        const remainingListPos =
          $from.depth > 0 ? $from.after($from.depth) : -1;
        const remainingList = transaction.doc.nodeAt(remainingListPos);
        if (remainingList?.type === gfmSchema.nodes.ordered_list) {
          transaction.setNodeMarkup(remainingListPos, undefined, {
            ...remainingList.attrs,
            order: Number(list.attrs.order) + 1,
          });
        }
        dispatch(transaction);
      });
    }

    const previousItem = $from.node(itemDepth - 1).child(itemIndex - 1);
    if (!canJoinListItems(previousItem, item)) {
      return nested
        ? changeListIndent("outdent")(state, dispatch, view)
        : true;
    }

    return joinListItemBackward(state, dispatch, view);
  };
}

function canJoinListItems(
  previousItem: import("prosemirror-model").Node,
  item: import("prosemirror-model").Node,
) {
  if (previousItem.type !== item.type) return false;
  return (
    item.type !== gfmSchema.nodes.task_list_item ||
    previousItem.attrs.checked === item.attrs.checked
  );
}

function joinListItemBackward(
  state: Parameters<Command>[0],
  dispatch: Parameters<Command>[1],
  view: EditorView | undefined,
) {
  return joinBackward(
    state,
    dispatch
      ? (transaction) => dispatch(normalizeJoinedListMetadata(transaction))
      : undefined,
    view,
  );
}

function normalizeJoinedListMetadata(transaction: Transaction) {
  const { $from } = transaction.selection;
  let itemDepth = -1;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (isListItemNode($from.node(depth))) {
      itemDepth = depth;
      break;
    }
  }
  if (itemDepth < 0) return transaction;

  const item = $from.node(itemDepth);
  const requiresSpread =
    item.childCount > 1 &&
    Array.from({ length: item.childCount - 1 }, (_, index) =>
      item.child(index + 1),
    ).some((child) => !isListNode(child));
  if (!requiresSpread) return transaction;

  const itemPos = $from.before(itemDepth);
  transaction.setNodeMarkup(itemPos, undefined, {
    ...item.attrs,
    spread: true,
  });

  const list = $from.node(itemDepth - 1);
  transaction.setNodeMarkup($from.before(itemDepth - 1), undefined, {
    ...list.attrs,
    tight: list.childCount === 1,
  });
  return transaction;
}

function hasNestedListItemParent($from: Parameters<typeof nearestListItemDepth>[0]) {
  const itemDepth = nearestListItemDepth($from);
  return itemDepth >= 3 && isListItemType($from.node(itemDepth - 2).type);
}

function nearestListItemDepth(
  $from: import("prosemirror-model").ResolvedPos,
) {
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    if (isListItemType($from.node(depth).type)) return depth;
  }
  return -1;
}
