import { Menu } from "@base-ui/react/menu";
import { CircleAlert } from "lucide-react";
import type { Command, EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import * as React from "react";
import { currentAlertKind, setAlert } from "./commands";
import { alertKinds, alertLabel } from "./model";

export function AlertToolbar({
  onCommand,
  state,
  view,
}: {
  onCommand: (command: Command) => boolean;
  state: EditorState;
  view: EditorView;
}) {
  const activeKind = currentAlertKind(state);

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label="Alert type"
        className="gfmd-toolbar-button"
        data-active={activeKind ? "" : undefined}
        disabled={!setAlert("note")(state, undefined, view)}
        title={activeKind ? `Alert: ${alertLabel(activeKind)}` : "Alert"}
        type="button"
      >
        <CircleAlert className="gfmd-toolbar-icon" size={16} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4}>
          <Menu.Popup aria-label="Alert types" className="gfmd-alert-menu">
            {alertKinds.map((kind) => (
              <Menu.Item
                className="gfmd-alert-menu-item"
                data-active={activeKind === kind ? "" : undefined}
                key={kind}
                onClick={() => onCommand(setAlert(kind))}
              >
                <span
                  aria-hidden
                  className={`gfmd-alert-menu-swatch gfmd-alert-menu-swatch-${kind}`}
                />
                {alertLabel(kind)}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
