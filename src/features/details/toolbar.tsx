import { Toolbar } from "@base-ui/react/toolbar";
import { ListCollapse } from "lucide-react";
import type { Command, EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import * as React from "react";
import { insertDetails } from "./commands";

export function DetailsToolbar({
  onCommand,
  state,
  view,
}: {
  onCommand: (command: Command) => boolean;
  state: EditorState;
  view: EditorView;
}) {
  return (
    <Toolbar.Button
      aria-label="Insert details"
      className="gfmd-toolbar-button"
      disabled={!insertDetails(state, undefined, view)}
      onClick={() => onCommand(insertDetails)}
      onMouseDown={(event) => event.preventDefault()}
      title="Insert details"
      type="button"
    >
      <ListCollapse className="gfmd-toolbar-icon" size={16} />
    </Toolbar.Button>
  );
}
