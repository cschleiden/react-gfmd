import { Menu } from "@base-ui/react/menu";
import { Toolbar } from "@base-ui/react/toolbar";
import type { Command, EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import * as React from "react";
import {
  footnoteRenameError,
  insertFootnote,
  insertFootnoteReference,
  renameFootnote,
  selectedFootnoteIdentifier,
} from "./commands";
import { footnoteEntry } from "./model";
import { footnoteIndexForState } from "./plugin";

interface FootnoteToolbarProps {
  onCommand: (command: Command) => boolean;
  state: EditorState;
  view: EditorView;
}

export function FootnoteToolbar({
  onCommand,
  state,
  view,
}: FootnoteToolbarProps) {
  const index = footnoteIndexForState(state);
  const definitions = index.definitions;
  const selectedIdentifier = selectedFootnoteIdentifier(state);

  return (
    <>
      <Menu.Root modal={false}>
        <Menu.Trigger
          aria-label="Insert footnote"
          className="gfmd-toolbar-button"
          disabled={!insertFootnote(state, undefined, view)}
          title="Insert footnote"
          type="button"
        >
          <FootnoteIcon />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={4}>
            <Menu.Popup
              aria-label="Footnote options"
              className="gfmd-footnote-menu"
            >
              <Menu.Item
                className="gfmd-footnote-menu-item"
                onClick={() => onCommand(insertFootnote)}
              >
                <span>New footnote</span>
                <small>Create a reference and definition</small>
              </Menu.Item>
              {definitions.length ? (
                <>
                  <Menu.Separator className="gfmd-footnote-menu-separator" />
                  <div className="gfmd-footnote-menu-label">
                    Reference existing
                  </div>
                  {definitions.map((definition) => (
                    <Menu.Item
                      className="gfmd-footnote-menu-item"
                      key={definition.identifier}
                      onClick={() =>
                        onCommand(
                          insertFootnoteReference(definition.identifier),
                        )
                      }
                    >
                      <span>[^{definition.label}]</span>
                      <small>Add another reference</small>
                    </Menu.Item>
                  ))}
                </>
              ) : null}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {selectedIdentifier ? (
        <RenameFootnoteButton
          identifier={selectedIdentifier}
          label={
            footnoteEntry(index, selectedIdentifier)?.label ??
            selectedIdentifier
          }
          onCommand={onCommand}
          view={view}
        />
      ) : null}
    </>
  );
}

function RenameFootnoteButton({
  identifier,
  label: currentLabel,
  onCommand,
  view,
}: {
  identifier: string;
  label: string;
  onCommand: (command: Command) => boolean;
  view: EditorView;
}) {
  return (
    <Toolbar.Button
      aria-label="Rename footnote"
      className="gfmd-toolbar-button gfmd-toolbar-rename-footnote"
      onClick={() => {
        const label = globalThis.window?.prompt?.(
          "Footnote label",
          currentLabel,
        );
        if (label === null || label === undefined) return;

        const error = footnoteRenameError(view.state.doc, identifier, label);
        if (error) {
          globalThis.window?.alert?.(error);
          return;
        }
        if (!onCommand(renameFootnote(identifier, label))) {
          globalThis.window?.alert?.("The selected footnote no longer exists.");
        }
      }}
      onMouseDown={(event) => event.preventDefault()}
      title="Rename footnote"
      type="button"
    >
      <FootnoteIcon />
    </Toolbar.Button>
  );
}

function FootnoteIcon() {
  return (
    <span className="gfmd-toolbar-footnote-icon" aria-hidden>
      [^]
    </span>
  );
}
