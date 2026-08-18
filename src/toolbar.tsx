import { Menu } from "@base-ui/react/menu";
import { Toolbar } from "@base-ui/react/toolbar";
import {
  Bold,
  BrushCleaning,
  ChevronDown,
  Code,
  FileCode2,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Keyboard,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Subscript,
  Superscript,
  Undo2,
} from "lucide-react";
import { setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import type { NodeType } from "prosemirror-model";
import { EditorState, type Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import * as React from "react";
import { AlertToolbar } from "./features/alerts/toolbar";
import { LinkEditor } from "./link-editor";
import {
  changeListIndent,
  changeListType,
  currentListKind,
  insertTaskList,
  isCurrentListType,
  isInAnyListItem,
} from "./lists/commands";
import { FootnoteToolbar } from "./features/footnotes";
import { runIsolatedCommand } from "./history";
import { gfmSchema } from "./schema";

interface GFMarkdownToolbarProps {
  className?: string;
  state: EditorState;
  view: EditorView;
}

interface ToolbarAction {
  id: string;
  icon: React.ReactNode;
  title: string;
  command: Command;
  active?: (state: EditorState) => boolean;
}

const markActions: ToolbarAction[] = [
  markAction(
    "bold",
    <Bold className="gfmd-toolbar-icon" size={16} />,
    "Bold",
    "strong",
  ),
  markAction(
    "italic",
    <Italic className="gfmd-toolbar-icon" size={16} />,
    "Italic",
    "em",
  ),
  markAction(
    "strike",
    <Strikethrough className="gfmd-toolbar-icon" size={16} />,
    "Strikethrough",
    "strike",
  ),
  markAction(
    "code",
    <Code className="gfmd-toolbar-icon" size={16} />,
    "Inline code",
    "code",
  ),
  markAction(
    "keyboard-input",
    <Keyboard className="gfmd-toolbar-icon" size={16} />,
    "Keyboard input",
    "keyboard_input",
  ),
  markAction(
    "subscript",
    <Subscript className="gfmd-toolbar-icon" size={16} />,
    "Subscript",
    "subscript",
  ),
  markAction(
    "superscript",
    <Superscript className="gfmd-toolbar-icon" size={16} />,
    "Superscript",
    "superscript",
  ),
  {
    id: "clear-formatting",
    icon: <BrushCleaning className="gfmd-toolbar-icon" size={16} />,
    title: "Clear formatting",
    command: clearFormatting,
    active: hasInlineFormatting,
  },
];

const blockActions: ToolbarAction[] = [
  {
    id: "quote",
    icon: <Quote className="gfmd-toolbar-icon" size={16} />,
    title: "Quote",
    command: wrapIn(gfmSchema.nodes.blockquote),
    active: hasAncestor(gfmSchema.nodes.blockquote),
  },
  {
    id: "bullet-list",
    icon: <List className="gfmd-toolbar-icon" size={16} />,
    title: "Bulleted list",
    command: changeListType("bullet"),
    active: isCurrentListType(gfmSchema.nodes.bullet_list),
  },
  {
    id: "ordered-list",
    icon: <ListOrdered className="gfmd-toolbar-icon" size={16} />,
    title: "Numbered list",
    command: changeListType("ordered"),
    active: isCurrentListType(gfmSchema.nodes.ordered_list),
  },
  {
    id: "task-list",
    icon: <ListChecks className="gfmd-toolbar-icon" size={16} />,
    title: "Task list",
    command: insertTaskList,
    active: (state) => currentListKind(state) === "task",
  },
  {
    id: "indent-list",
    icon: <IndentIncrease className="gfmd-toolbar-icon" size={16} />,
    title: "Indent list item",
    command: changeListIndent("indent"),
    active: isInAnyListItem,
  },
  {
    id: "outdent-list",
    icon: <IndentDecrease className="gfmd-toolbar-icon" size={16} />,
    title: "Outdent list item",
    command: changeListIndent("outdent"),
    active: isInAnyListItem,
  },
  {
    id: "code-block",
    icon: <FileCode2 className="gfmd-toolbar-icon" size={16} />,
    title: "Code block",
    command: setBlockType(gfmSchema.nodes.code_block),
    active: (state) =>
      state.selection.$from.parent.type === gfmSchema.nodes.code_block,
  },
  {
    id: "rule",
    icon: <Minus className="gfmd-toolbar-icon" size={16} />,
    title: "Horizontal rule",
    command: insertHorizontalRule,
  },
];

export function GFMarkdownToolbar({
  className,
  state,
  view,
}: GFMarkdownToolbarProps) {
  return (
    <Toolbar.Root
      className={["gfmd-toolbar", className].filter(Boolean).join(" ")}
      aria-label="Markdown formatting"
      onKeyDown={(event) => handleToolbarKeyDown(event, view)}
    >
      <Toolbar.Group className="gfmd-toolbar-group" aria-label="History">
        <HistoryButton
          ariaKeyShortcuts="Meta+Z Control+Z"
          command={undo}
          icon={<Undo2 className="gfmd-toolbar-icon" size={16} />}
          label="Undo"
          shortcut={historyShortcut("undo")}
          state={state}
          view={view}
        />
        <HistoryButton
          ariaKeyShortcuts="Meta+Shift+Z Control+Shift+Z Control+Y"
          command={redo}
          icon={<Redo2 className="gfmd-toolbar-icon" size={16} />}
          label="Redo"
          shortcut={historyShortcut("redo")}
          state={state}
          view={view}
        />
      </Toolbar.Group>
      <Toolbar.Separator className="gfmd-toolbar-separator" />
      <Toolbar.Group
        className="gfmd-toolbar-group"
        aria-label="Inline formatting"
      >
        {markActions.map((action) => (
          <ToolbarActionButton
            action={action}
            key={action.id}
            state={state}
            view={view}
          />
        ))}
      </Toolbar.Group>
      <Toolbar.Separator className="gfmd-toolbar-separator" />
      <Toolbar.Group
        className="gfmd-toolbar-group"
        aria-label="Block formatting"
      >
        <HeadingLevelSelect state={state} view={view} />
        <FootnoteToolbar
          onCommand={(command) => runCommand(view, command)}
          state={state}
          view={view}
        />
        <AlertToolbar
          onCommand={(command) => runCommand(view, command)}
          state={state}
          view={view}
        />
        {blockActions.map((action) => (
          <ToolbarActionButton
            action={action}
            key={action.id}
            state={state}
            view={view}
          />
        ))}
        <LinkEditor state={state} view={view} />
      </Toolbar.Group>
    </Toolbar.Root>
  );
}

function HistoryButton({
  ariaKeyShortcuts,
  command,
  icon,
  label,
  shortcut,
  state,
  view,
}: {
  ariaKeyShortcuts: string;
  command: Command;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
  state: EditorState;
  view: EditorView;
}) {
  return (
    <Toolbar.Button
      aria-keyshortcuts={ariaKeyShortcuts}
      aria-label={label}
      className="gfmd-toolbar-button"
      disabled={!command(state, undefined, view)}
      onClick={() => {
        command(view.state, view.dispatch, view);
        view.focus();
      }}
      onMouseDown={(event) => event.preventDefault()}
      title={`${label} (${shortcut})`}
      type="button"
    >
      {icon}
    </Toolbar.Button>
  );
}

function HeadingLevelSelect({
  state,
  view,
}: {
  state: EditorState;
  view: EditorView;
}) {
  const parent = state.selection.$from.parent;
  const activeLevel =
    parent.type === gfmSchema.nodes.heading ? Number(parent.attrs.level) : null;

  const triggerLabel = activeLevel ? `H${activeLevel}` : "Text";

  const options: Array<{
    id: string;
    label: string;
    previewClassName: string;
    onSelect: () => void;
  }> = [
    {
      id: "paragraph",
      label: "Text",
      previewClassName: "gfmd-text-option-preview gfmd-text-option-text",
      onSelect: () => runCommand(view, setBlockType(gfmSchema.nodes.paragraph)),
    },
    {
      id: "h1",
      label: "Heading 1",
      previewClassName: "gfmd-text-option-preview gfmd-text-option-h1",
      onSelect: () =>
        runCommand(view, setBlockType(gfmSchema.nodes.heading, { level: 1 })),
    },
    {
      id: "h2",
      label: "Heading 2",
      previewClassName: "gfmd-text-option-preview gfmd-text-option-h2",
      onSelect: () =>
        runCommand(view, setBlockType(gfmSchema.nodes.heading, { level: 2 })),
    },
    {
      id: "h3",
      label: "Heading 3",
      previewClassName: "gfmd-text-option-preview gfmd-text-option-h3",
      onSelect: () =>
        runCommand(view, setBlockType(gfmSchema.nodes.heading, { level: 3 })),
    },
    {
      id: "h4",
      label: "Heading 4",
      previewClassName: "gfmd-text-option-preview gfmd-text-option-h4",
      onSelect: () =>
        runCommand(view, setBlockType(gfmSchema.nodes.heading, { level: 4 })),
    },
    {
      id: "h5",
      label: "Heading 5",
      previewClassName: "gfmd-text-option-preview gfmd-text-option-h5",
      onSelect: () =>
        runCommand(view, setBlockType(gfmSchema.nodes.heading, { level: 5 })),
    },
    {
      id: "h6",
      label: "Heading 6",
      previewClassName: "gfmd-text-option-preview gfmd-text-option-h6",
      onSelect: () =>
        runCommand(view, setBlockType(gfmSchema.nodes.heading, { level: 6 })),
    },
  ];

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        aria-label="Text style"
        className="gfmd-text-style-trigger"
        title="Text style"
        type="button"
      >
        <span className="gfmd-text-style-trigger-label">{triggerLabel}</span>
        <ChevronDown className="gfmd-text-style-trigger-icon" size={14} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4}>
          <Menu.Popup
            className="gfmd-text-style-menu"
            aria-label="Text style options"
          >
            {options.map((option) => (
              <Menu.Item
                className="gfmd-text-style-item"
                data-active={
                  option.id === (activeLevel ? `h${activeLevel}` : "paragraph")
                    ? ""
                    : undefined
                }
                key={option.id}
                onClick={option.onSelect}
              >
                <span className={option.previewClassName}>{option.label}</span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ToolbarActionButton({
  action,
  state,
  view,
}: {
  action: ToolbarAction;
  state: EditorState;
  view: EditorView;
}) {
  const active = action.active?.(state) ?? false;
  const disabled = !action.command(state, undefined, view);

  return (
    <Toolbar.Button
      aria-label={action.title}
      aria-pressed={active}
      className="gfmd-toolbar-button"
      data-active={active ? "" : undefined}
      disabled={disabled}
      onClick={() => runCommand(view, action.command)}
      onMouseDown={(event) => event.preventDefault()}
      title={action.title}
      type="button"
    >
      {action.icon}
    </Toolbar.Button>
  );
}

function markAction(
  id: string,
  icon: React.ReactNode,
  title: string,
  markName: string,
): ToolbarAction {
  return {
    id,
    icon,
    title,
    command: toggleMark(gfmSchema.marks[markName]),
    active: (state) => markActive(state, markName),
  };
}

function clearFormatting(
  state: EditorState,
  dispatch?: EditorView["dispatch"],
) {
  const { empty, from, to, $from } = state.selection;

  if (empty) {
    const activeMarks = state.storedMarks ?? $from.marks();
    if (!activeMarks.length) return false;
    if (!dispatch) return true;
    dispatch(state.tr.setStoredMarks([]));
    return true;
  }

  let hasAnyMark = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText || !node.marks.length) return;
    hasAnyMark = true;
  });
  if (!hasAnyMark) return false;
  if (!dispatch) return true;

  let tr = state.tr;
  for (const markType of Object.values(gfmSchema.marks)) {
    tr = tr.removeMark(from, to, markType);
  }

  dispatch(tr.scrollIntoView());
  return true;
}

function hasInlineFormatting(state: EditorState) {
  const { empty, from, to, $from } = state.selection;
  if (empty) {
    return Boolean((state.storedMarks ?? $from.marks()).length);
  }

  let hasAnyMark = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText || !node.marks.length) return;
    hasAnyMark = true;
  });
  return hasAnyMark;
}

function runCommand(view: EditorView, command: Command) {
  return runIsolatedCommand(view, command);
}

function handleToolbarKeyDown(
  event: React.KeyboardEvent,
  view: EditorView,
) {
  if (isEditableTarget(event.target)) return;

  const key = event.key.toLowerCase();
  const modified = event.metaKey || event.ctrlKey;
  const command =
    modified && key === "z"
      ? event.shiftKey
        ? redo
        : undo
      : modified && key === "y" && !event.shiftKey
        ? redo
        : null;
  if (!command) return;

  event.preventDefault();
  command(view.state, view.dispatch, view);
  view.focus();
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function historyShortcut(action: "undo" | "redo") {
  const apple =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  if (action === "undo") return apple ? "\u2318Z" : "Ctrl+Z";
  return apple ? "\u21e7\u2318Z" : "Ctrl+Y";
}

function markActive(state: EditorState, markName: string) {
  const mark = gfmSchema.marks[markName];
  const { empty, from, $from, to } = state.selection;

  return empty
    ? Boolean(mark.isInSet(state.storedMarks ?? $from.marks()))
    : state.doc.rangeHasMark(from, to, mark);
}

function hasAncestor(type: NodeType) {
  return (state: EditorState) => {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type === type) return true;
    }
    return false;
  };
}

function insertHorizontalRule(
  state: EditorState,
  dispatch?: EditorView["dispatch"],
) {
  if (!dispatch) return true;
  dispatch(
    state.tr
      .replaceSelectionWith(gfmSchema.nodes.horizontal_rule.create())
      .scrollIntoView(),
  );
  return true;
}
