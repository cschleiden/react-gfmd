import { Menu } from "@base-ui/react/menu";
import { Toolbar } from "@base-ui/react/toolbar";
import {
  BrushCleaning,
  Check,
  ChevronRight,
  CircleAlert,
  FileText,
  Heading,
  ListCollapse,
  MoreHorizontal,
} from "lucide-react";
import { setBlockType } from "prosemirror-commands";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
  TextSelection,
  type Command,
  type EditorState,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import * as React from "react";
import { createPortal } from "react-dom";
import { currentAlertKind, setAlert } from "./features/alerts/commands";
import { alertKinds, alertLabel } from "./features/alerts/model";
import { insertDetails } from "./features/details/commands";
import {
  footnoteRenameError,
  insertFootnote,
  insertFootnoteReference,
  renameFootnote,
  selectedFootnoteIdentifier,
} from "./features/footnotes/commands";
import { footnoteEntry } from "./features/footnotes/model";
import { footnoteIndexForState } from "./features/footnotes/plugin";
import { LinkEditor } from "./link-editor";
import { gfmSchema } from "./schema";
import {
  blockActions,
  markActions,
  runToolbarCommand,
  ToolbarActionButton,
  type ToolbarAction,
} from "./toolbar";

const ownerAttribute = "data-gfmd-contextual-owner";

interface ContextualToolbarProps {
  state: EditorState;
  view: EditorView;
}

interface Position {
  left: number;
  top: number;
}

interface DismissedSelection {
  doc: ProseMirrorNode;
  from: number;
  to: number;
}

export function ContextualToolbar({
  state,
  view,
}: ContextualToolbarProps) {
  const ownerId = React.useId();
  const toolbarRef = React.useRef<HTMLDivElement>(null);
  const interactionRef = React.useRef(false);
  const linkOpenRef = React.useRef(false);
  const moreOpenRef = React.useRef(false);
  const dismissedSelectionRef = React.useRef<DismissedSelection | null>(null);
  const visibleRef = React.useRef(false);
  const [linkResetKey, setLinkResetKey] = React.useState(0);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const [position, setPosition] = React.useState<Position | null>(null);
  const eligible = isContextualSelection(state);
  const signature = selectionSignature(state);
  const updateVisible = React.useCallback((nextVisible: boolean) => {
    if (visibleRef.current === nextVisible) return;
    visibleRef.current = nextVisible;
    setVisible(nextVisible);
  }, []);

  React.useEffect(() => {
    if (!eligible) {
      dismissedSelectionRef.current = null;
      updateVisible(false);
      return;
    }
    if (
      !selectionWasDismissed(state, dismissedSelectionRef.current) &&
      view.hasFocus()
    ) {
      updateVisible(true);
    }
  }, [eligible, signature, state, updateVisible, view]);

  React.useEffect(() => {
    const document = view.dom.ownerDocument;

    function isOwnedTarget(target: EventTarget | null) {
      return (
        target instanceof Element &&
        (view.dom.contains(target) ||
          target.closest(`[${ownerAttribute}="${ownerId}"]`))
      );
    }

    function handleFocusIn(event: FocusEvent) {
      if (isOwnedTarget(event.target)) {
        if (
          isContextualSelection(view.state) &&
          !selectionWasDismissed(view.state, dismissedSelectionRef.current)
        ) {
          updateVisible(true);
        }
        return;
      }
      if (!interactionRef.current) updateVisible(false);
    }

    function handlePointerDown(event: PointerEvent) {
      if (isOwnedTarget(event.target)) return;
      interactionRef.current = false;
      updateVisible(false);
    }

    function handleEditorKeyDown(event: KeyboardEvent) {
      if (!event.altKey || event.key !== "F10") return;
      if (!isContextualSelection(view.state)) return;
      event.preventDefault();
      dismissedSelectionRef.current = null;
      updateVisible(true);
      document.defaultView?.requestAnimationFrame(() => {
        document.defaultView?.requestAnimationFrame(() => {
          toolbarRef.current
            ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
            ?.focus();
        });
      });
    }

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("pointerdown", handlePointerDown, true);
    view.dom.addEventListener("keydown", handleEditorKeyDown);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      view.dom.removeEventListener("keydown", handleEditorKeyDown);
    };
  }, [ownerId, updateVisible, view]);

  React.useLayoutEffect(() => {
    if (!visible || !eligible) {
      setPosition(null);
      return;
    }

    const defaultView = view.dom.ownerDocument.defaultView;
    if (!defaultView) return;
    const browserWindow: Window = defaultView;
    let frame = 0;

    function updatePosition() {
      browserWindow.cancelAnimationFrame(frame);
      frame = browserWindow.requestAnimationFrame(() => {
        const toolbar = toolbarRef.current;
        const selectionRect = selectedTextRect(view);
        if (!toolbar || !selectionRect) {
          setPosition(null);
          return;
        }
        if (
          selectionRect.bottom <= 0 ||
          selectionRect.top >= browserWindow.innerHeight ||
          selectionRect.right <= 0 ||
          selectionRect.left >= browserWindow.innerWidth
        ) {
          closeOverlays();
          setPosition(null);
          return;
        }

        const margin = 8;
        const gap = 8;
        const toolbarRect = toolbar.getBoundingClientRect();
        const maxLeft = Math.max(
          margin,
          browserWindow.innerWidth - toolbarRect.width - margin,
        );
        const left = clamp(
          selectionRect.left +
            selectionRect.width / 2 -
            toolbarRect.width / 2,
          margin,
          maxLeft,
        );
        const above = selectionRect.top - toolbarRect.height - gap;
        const below = selectionRect.bottom + gap;
        const maxTop = Math.max(
          margin,
          browserWindow.innerHeight - toolbarRect.height - margin,
        );
        const top = clamp(above >= margin ? above : below, margin, maxTop);
        setPosition({ left, top });
      });
    }

    updatePosition();
    browserWindow.addEventListener("resize", updatePosition);
    browserWindow.addEventListener("scroll", updatePosition, true);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updatePosition);
    if (toolbarRef.current) observer?.observe(toolbarRef.current);

    return () => {
      browserWindow.cancelAnimationFrame(frame);
      browserWindow.removeEventListener("resize", updatePosition);
      browserWindow.removeEventListener("scroll", updatePosition, true);
      observer?.disconnect();
    };
  }, [eligible, signature, view, visible]);

  if (!eligible || !visible || !view.dom.ownerDocument.body) return null;

  function closeOverlays() {
    if (!moreOpenRef.current && !linkOpenRef.current) return;
    moreOpenRef.current = false;
    linkOpenRef.current = false;
    interactionRef.current = false;
    setMoreOpen(false);
    setLinkResetKey((current) => current + 1);
  }

  function handleLinkOpenChange(open: boolean) {
    linkOpenRef.current = open;
    interactionRef.current = open || moreOpenRef.current;
    if (open) updateVisible(true);
  }

  function handleMoreOpenChange(open: boolean) {
    moreOpenRef.current = open;
    interactionRef.current = open || linkOpenRef.current;
    setMoreOpen(open);
    if (open) updateVisible(true);
  }

  function dismiss() {
    dismissedSelectionRef.current = {
      doc: view.state.doc,
      from: view.state.selection.from,
      to: view.state.selection.to,
    };
    interactionRef.current = false;
    updateVisible(false);
    view.focus();
  }

  return createPortal(
    <div
      className="gfmd-contextual-toolbar-positioner"
      ref={toolbarRef}
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
      {...{ [ownerAttribute]: ownerId }}
    >
      <Toolbar.Root
        aria-label="Selection formatting"
        className="gfmd-contextual-toolbar"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          dismiss();
        }}
      >
        <Toolbar.Group
          aria-label="Common inline formatting"
          className="gfmd-toolbar-group"
        >
          {markActions.map((action) => (
            <ToolbarActionButton
              action={action}
              key={action.id}
              state={state}
              view={view}
            />
          ))}
          <LinkEditor
            contextualOwnerId={ownerId}
            onOpenChange={handleLinkOpenChange}
            resetKey={linkResetKey}
            state={state}
            view={view}
          />
          <ContextualMoreMenu
            onOpenChange={handleMoreOpenChange}
            open={moreOpen}
            ownerId={ownerId}
            state={state}
            view={view}
          />
        </Toolbar.Group>
      </Toolbar.Root>
    </div>,
    view.dom.ownerDocument.body,
  );
}

function ContextualMoreMenu({
  onOpenChange,
  open,
  ownerId,
  state,
  view,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  ownerId: string;
  state: EditorState;
  view: EditorView;
}) {
  const enabledBlockActions = blockActions.filter((action) =>
    action.command(state, undefined, view),
  );
  const textStyleActions = contextualTextStyleActions(state).filter((action) =>
    action.command(state, undefined, view),
  );
  const alertActions = contextualAlertActions(state);
  const footnoteActions = contextualFootnoteActions(state, view);
  const detailsEnabled = insertDetails(state, undefined, view);

  return (
    <Menu.Root modal={false} onOpenChange={onOpenChange} open={open}>
      <Menu.Trigger
        aria-label="More formatting"
        className="gfmd-toolbar-button"
        onMouseDown={(event) => event.preventDefault()}
        title="More formatting"
        type="button"
      >
        <MoreHorizontal className="gfmd-toolbar-icon" size={16} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6}>
          <Menu.Popup
            aria-label="More formatting options"
            className="gfmd-contextual-menu"
            {...{ [ownerAttribute]: ownerId }}
          >
            {textStyleActions.length ? (
              <ContextualSubmenu
                actions={textStyleActions}
                icon={<FileText size={16} />}
                label="Text style"
                ownerId={ownerId}
                view={view}
              />
            ) : null}
            {alertActions.length ? (
              <ContextualSubmenu
                actions={alertActions}
                icon={<CircleAlert size={16} />}
                label="GitHub alert"
                ownerId={ownerId}
                view={view}
              />
            ) : null}
            {footnoteActions.length ? (
              <ContextualSubmenu
                actions={footnoteActions}
                icon={<FootnoteIcon />}
                label="Footnotes"
                ownerId={ownerId}
                view={view}
              />
            ) : null}
            {detailsEnabled || enabledBlockActions.length ? (
              <ContextualSubmenu
                actions={[
                  ...(detailsEnabled
                    ? [
                        {
                          id: "details",
                          icon: <ListCollapse size={16} />,
                          title: "Insert details",
                          command: insertDetails,
                        },
                      ]
                    : []),
                  ...enabledBlockActions,
                ]}
                icon={<ListCollapse size={16} />}
                label="Blocks"
                ownerId={ownerId}
                view={view}
              />
            ) : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ContextualSubmenu({
  actions,
  icon,
  label,
  ownerId,
  view,
}: {
  actions: ToolbarAction[];
  icon: React.ReactNode;
  label: string;
  ownerId: string;
  view: EditorView;
}) {
  const active = actions.some((action) => action.active?.(view.state));
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger
        className="gfmd-contextual-menu-item"
        data-active={active ? "" : undefined}
        openOnHover
      >
        <span className="gfmd-contextual-menu-icon">{icon}</span>
        <span>{label}</span>
        <ChevronRight aria-hidden size={14} />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner align="start" side="right" sideOffset={4}>
          <Menu.Popup
            aria-label={`${label} options`}
            className="gfmd-contextual-menu gfmd-contextual-submenu"
            {...{ [ownerAttribute]: ownerId }}
          >
            {actions.map((action) => (
              <ContextualActionItem
                action={action}
                key={action.id}
                view={view}
              />
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

function ContextualActionItem({
  action,
  view,
}: {
  action: ToolbarAction;
  view: EditorView;
}) {
  const active = action.active?.(view.state) ?? false;
  return (
    <Menu.Item
      className="gfmd-contextual-menu-item"
      data-active={active ? "" : undefined}
      onClick={() => runToolbarCommand(view, action.command)}
    >
      <span className="gfmd-contextual-menu-icon">{action.icon}</span>
      <span>{action.title}</span>
      {active ? <Check aria-hidden size={14} /> : null}
    </Menu.Item>
  );
}

function contextualTextStyleActions(state: EditorState): ToolbarAction[] {
  const parent = state.selection.$from.parent;
  const currentLevel =
    parent.type === gfmSchema.nodes.heading ? Number(parent.attrs.level) : null;
  return [
    {
      id: "paragraph",
      icon: <FileText size={16} />,
      title: "Text",
      command: setBlockType(gfmSchema.nodes.paragraph),
      active: (currentState) =>
        currentState.selection.$from.parent.type === gfmSchema.nodes.paragraph,
    },
    ...Array.from({ length: 6 }, (_, index) => {
      const level = index + 1;
      return {
        id: `heading-${level}`,
        icon: <Heading size={16} />,
        title: `Heading ${level}`,
        command: setBlockType(gfmSchema.nodes.heading, { level }),
        active: () => currentLevel === level,
      };
    }),
  ];
}

function contextualAlertActions(state: EditorState): ToolbarAction[] {
  const activeKind = currentAlertKind(state);
  return alertKinds
    .map((kind) => ({
      id: `alert-${kind}`,
      icon: <CircleAlert size={16} />,
      title: `Alert: ${alertLabel(kind)}`,
      command: setAlert(kind),
      active: () => activeKind === kind,
    }))
    .filter((action) => action.command(state));
}

function contextualFootnoteActions(
  state: EditorState,
  view: EditorView,
): ToolbarAction[] {
  const actions: ToolbarAction[] = [];
  const index = footnoteIndexForState(state);
  if (insertFootnote(state, undefined, view)) {
    actions.push({
      id: "new-footnote",
      icon: <FootnoteIcon />,
      title: "New footnote",
      command: insertFootnote,
    });
  }
  for (const definition of index.definitions) {
    const command = insertFootnoteReference(definition.identifier);
    if (!command(state, undefined, view)) continue;
    actions.push({
      id: `footnote-reference-${definition.identifier}`,
      icon: <FootnoteIcon />,
      title: `Reference footnote ${definition.label}`,
      command,
    });
  }

  const identifier = selectedFootnoteIdentifier(state);
  if (identifier) {
    const label = footnoteEntry(index, identifier)?.label ?? identifier;
    actions.push({
      id: "rename-footnote",
      icon: <BrushCleaning size={16} />,
      title: "Rename footnote",
      command: promptToRenameFootnote(identifier, label),
      active: () => true,
    });
  }
  return actions;
}

function promptToRenameFootnote(
  identifier: string,
  currentLabel: string,
): Command {
  return (state, dispatch, view) => {
    if (!dispatch || !view) return Boolean(selectedFootnoteIdentifier(state));
    const label = globalThis.window?.prompt?.("Footnote label", currentLabel);
    if (label === null || label === undefined) return false;
    const error = footnoteRenameError(view.state.doc, identifier, label);
    if (error) {
      globalThis.window?.alert?.(error);
      return false;
    }
    if (!renameFootnote(identifier, label)(view.state, view.dispatch, view)) {
      globalThis.window?.alert?.("The selected footnote no longer exists.");
      return false;
    }
    return true;
  };
}

function isContextualSelection(state: EditorState) {
  return state.selection instanceof TextSelection && !state.selection.empty;
}

function selectionSignature(state: EditorState) {
  const { from, to } = state.selection;
  return `${from}:${to}:${state.doc.content.size}`;
}

function selectionWasDismissed(
  state: EditorState,
  dismissed: DismissedSelection | null,
) {
  return Boolean(
    dismissed &&
      dismissed.doc === state.doc &&
      dismissed.from === state.selection.from &&
      dismissed.to === state.selection.to,
  );
}

function FootnoteIcon() {
  return (
    <span aria-hidden className="gfmd-toolbar-footnote-icon">
      [^]
    </span>
  );
}

function selectedTextRect(view: EditorView): DOMRect | null {
  if (!isContextualSelection(view.state)) return null;
  const nativeSelection = view.dom.ownerDocument.getSelection();
  if (nativeSelection?.rangeCount) {
    const range = nativeSelection.getRangeAt(0);
    if (
      view.dom.contains(range.commonAncestorContainer) ||
      range.commonAncestorContainer === view.dom
    ) {
      const rect = range.getBoundingClientRect();
      if (rect.width || rect.height) return rect;
    }
  }

  try {
    const start = view.coordsAtPos(view.state.selection.from);
    const end = view.coordsAtPos(view.state.selection.to);
    const left = Math.min(start.left, end.left);
    const right = Math.max(start.right, end.right);
    const top = Math.min(start.top, end.top);
    const bottom = Math.max(start.bottom, end.bottom);
    return new DOMRect(
      left,
      top,
      Math.max(1, right - left),
      Math.max(1, bottom - top),
    );
  } catch {
    return null;
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
