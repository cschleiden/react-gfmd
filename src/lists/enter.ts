import { chainCommands } from "prosemirror-commands";
import { splitListItem } from "prosemirror-schema-list";
import type { Command, Transaction } from "prosemirror-state";
import { gfmSchema } from "../schema";
import { changeListIndent } from "./indent";
import { isListItemType, nearestListItemDepth } from "./utils";

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

function hasNestedListItemParent(
  $from: import("prosemirror-model").ResolvedPos,
) {
  const itemDepth = nearestListItemDepth($from);
  return itemDepth >= 3 && isListItemType($from.node(itemDepth - 2).type);
}
