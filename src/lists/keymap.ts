import { chainCommands } from "prosemirror-commands";
import { splitListItem } from "prosemirror-schema-list";
import type { Command } from "prosemirror-state";
import { gfmSchema } from "../schema";

export function splitCurrentListItem(): Command {
  return chainCommands(
    splitListItem(gfmSchema.nodes.task_list_item, { checked: false }),
    splitListItem(gfmSchema.nodes.list_item),
  );
}
