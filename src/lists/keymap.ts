import { chainCommands } from "prosemirror-commands";
import { splitListItem } from "prosemirror-schema-list";
import type { Command } from "prosemirror-state";
import { gfmSchema } from "../schema";
import { changeListIndent } from "./indent";
import { isListItemType } from "./utils";

export function splitCurrentListItem(): Command {
  return chainCommands(
    splitListItem(gfmSchema.nodes.task_list_item, { checked: false }),
    splitListItem(gfmSchema.nodes.list_item),
  );
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

    let itemDepth = -1;
    for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
      if (isListItemType($from.node(depth).type)) {
        itemDepth = depth;
        break;
      }
    }

    if (
      itemDepth < 3 ||
      $from.index(itemDepth) !== 0 ||
      !isListItemType($from.node(itemDepth - 2).type)
    ) {
      return false;
    }

    return changeListIndent("outdent")(state, dispatch, view);
  };
}
