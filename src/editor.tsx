import {
  ProseMirror,
  ProseMirrorDoc,
  reactKeys,
  useEditorEffect,
} from "@handlewithcare/react-prosemirror";
import { inputRules } from "@handlewithcare/prosemirror-inputrules";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { DOMParser as ProseMirrorDOMParser } from "prosemirror-model";
import { EditorState, Plugin, type Transaction } from "prosemirror-state";
import { tableEditing } from "prosemirror-tables";
import type { EditorView } from "prosemirror-view";
import * as React from "react";
import type {
  CreateGFMarkdownStateOptions,
  GFMarkdownEditorProps,
} from "./editor-types";
import { createAutolinkPlugin } from "./autolink";
import { createMarkdownClipboardPlugin } from "./clipboard";
import { CodeBlockNodeView } from "./features/code-block";
import { createGitHubColorPlugin } from "./features/colors";
import {
  createFootnotePlugin,
  FootnoteDefinitionNodeView,
  FootnoteReferenceNodeView,
} from "./features/footnotes";
import { createMarkdownInputRules } from "./input-rules";
import { changeListIndent } from "./lists/commands";
import {
  outdentNestedListItemAtStart,
  splitCurrentListItem,
} from "./lists/keymap";
import { createTaskListPlugin } from "./lists/plugin";
import { parseMarkdown, serializeMarkdown } from "./markdown";
import { gfmSchema } from "./schema";
import { createLinkInteractionPlugin } from "./link";
import { GFMarkdownToolbar } from "./toolbar";
import { ContextualToolbar } from "./contextual-toolbar";

export type {
  CreateGFMarkdownStateOptions,
  GFMarkdownEditorProps,
} from "./editor-types";

export function createGFMarkdownState(
  options: CreateGFMarkdownStateOptions,
): EditorState {
  return EditorState.create({
    doc: parseMarkdown(options.value, options.context),
    schema: gfmSchema,
    plugins: createPlugins(options),
  });
}

export function GFMarkdownEditor(props: GFMarkdownEditorProps) {
  const latestProps = React.useRef(props);
  latestProps.current = props;
  const lastAppliedValueRef = React.useRef(props.value);
  const lastAppliedContextRef = React.useRef(contextKey(props.context));
  const pendingChangeRef = React.useRef<PendingChange | null>(null);
  const [editorState, setEditorState] = React.useState<EditorState>(() =>
    createGFMarkdownState(props),
  );
  const [editorView, setEditorView] = React.useState<EditorView | null>(null);
  const nodeViews = React.useMemo(() => createNodeViews(latestProps), []);

  const clearPendingChange = React.useCallback(() => {
    const pending = pendingChangeRef.current;
    if (!pending) return;
    globalThis.clearTimeout(pending.timer);
    pendingChangeRef.current = null;
  }, []);

  const emitChange = React.useCallback((): string | null => {
    const pending = pendingChangeRef.current;
    if (!pending) return null;
    globalThis.clearTimeout(pending.timer);
    pendingChangeRef.current = null;

    const onChange = latestProps.current.onChange;
    if (!onChange) return null;
    const markdown = serializeMarkdown(pending.doc);
    lastAppliedValueRef.current = markdown;
    onChange(markdown, pending.doc);
    return markdown;
  }, []);

  const scheduleChange = React.useCallback(
    (doc: ProseMirrorNode) => {
      if (!latestProps.current.onChange) return;
      clearPendingChange();

      const delay = Math.max(0, latestProps.current.onChangeDebounceMs ?? 0);
      if (delay === 0) {
        pendingChangeRef.current = { doc, timer: 0 };
        emitChange();
        return;
      }

      const timer = globalThis.setTimeout(emitChange, delay);
      pendingChangeRef.current = { doc, timer };
    },
    [clearPendingChange, emitChange],
  );

  React.useEffect(() => {
    const nextContextKey = contextKey(props.context);
    const valueChanged = props.value !== lastAppliedValueRef.current;
    const contextChanged = nextContextKey !== lastAppliedContextRef.current;
    if (!valueChanged && !contextChanged) return;

    let nextValue = props.value;
    if (!valueChanged && contextChanged && pendingChangeRef.current) {
      const pendingDoc = pendingChangeRef.current.doc;
      nextValue = emitChange() ?? serializeMarkdown(pendingDoc);
    } else {
      clearPendingChange();
    }
    lastAppliedValueRef.current = nextValue;
    lastAppliedContextRef.current = nextContextKey;
    const nextState = createGFMarkdownState({
      ...latestProps.current,
      value: nextValue,
    });
    setEditorState(nextState);
  }, [
    clearPendingChange,
    emitChange,
    props.context.owner,
    props.context.repo,
    props.value,
  ]);

  React.useEffect(() => {
    return () => {
      emitChange();
    };
  }, [emitChange]);

  const dispatchTransaction = React.useCallback(
    (transaction: Transaction) => {
      setEditorState((state) => {
        const nextState = state.apply(transaction);
        if (transaction.docChanged) scheduleChange(nextState.doc);
        return nextState;
      });
    },
    [scheduleChange],
  );

  return (
    <div className={["gfmd-editor", props.className].filter(Boolean).join(" ")}>
      {props.toolbar !== false && editorView && editorState ? (
        <GFMarkdownToolbar
          className={props.toolbarClassName}
          state={editorState}
          view={editorView}
        />
      ) : null}
      {props.contextualToolbar !== false && editorView ? (
        <ContextualToolbar state={editorState} view={editorView} />
      ) : null}
      <ProseMirror
        attributes={{
          class: "gfmd-editor-surface",
          "data-placeholder": props.placeholder ?? "",
          ...(props.contextualToolbar === false
            ? {}
            : { "aria-keyshortcuts": "Alt+F10" }),
        }}
        dispatchTransaction={dispatchTransaction}
        nodeViews={nodeViews}
        state={editorState}
      >
        <ProseMirrorDoc />
        <EditorViewObserver
          onBlur={emitChange}
          onViewChange={setEditorView}
        />
      </ProseMirror>
    </div>
  );
}

interface PendingChange {
  doc: ProseMirrorNode;
  timer: ReturnType<typeof globalThis.setTimeout>;
}

function contextKey(context: GFMarkdownEditorProps["context"]) {
  return `${context.owner}\0${context.repo}`;
}

function EditorViewObserver({
  onBlur,
  onViewChange,
}: {
  onBlur: () => string | null;
  onViewChange: React.Dispatch<React.SetStateAction<EditorView | null>>;
}) {
  useEditorEffect(
    (view) => {
      onViewChange(view);
      if (!view) return undefined;

      const handleBlur = () => onBlur();
      view.dom.addEventListener("blur", handleBlur, true);
      return () => {
        view.dom.removeEventListener("blur", handleBlur, true);
        onViewChange(null);
      };
    },
    [onBlur, onViewChange],
  );

  return null;
}

function createPlugins(options: CreateGFMarkdownStateOptions): Plugin[] {
  return [
    history(),
    reactKeys(),
    createAutolinkPlugin(),
    createGitHubColorPlugin(),
    keymap({
      Enter: splitCurrentListItem(),
      Backspace: outdentNestedListItemAtStart(),
      Tab: changeListIndent("indent"),
      "Shift-Tab": changeListIndent("outdent"),
      "Mod-z": undo,
      "Shift-Mod-z": redo,
      "Mod-y": redo,
      "Mod-b": toggleMark(gfmSchema.marks.strong),
      "Mod-i": toggleMark(gfmSchema.marks.em),
      "Mod-`": toggleMark(gfmSchema.marks.code),
    }),
    keymap(baseKeymap),
    createTaskListPlugin(),
    createFootnotePlugin(),
    inputRules({
      rules: createMarkdownInputRules(options.context),
    }),
    createLinkInteractionPlugin(),
    tableEditing(),
    createMarkdownClipboardPlugin(options.context),
  ];
}

function createNodeViews(
  optionsRef: React.MutableRefObject<GFMarkdownEditorProps>,
) {
  return {
    code_block: (
      node: ProseMirrorNode,
      view: EditorView,
      getPos: () => number | undefined,
    ) => new CodeBlockNodeView(node, view, getPos),
    footnote_reference: (
      node: ProseMirrorNode,
      view: EditorView,
      getPos: () => number | undefined,
    ) => new FootnoteReferenceNodeView(node, view, getPos),
    footnote_definition: (
      node: ProseMirrorNode,
      view: EditorView,
    ) => new FootnoteDefinitionNodeView(node, view),
  };
}

export function parseHTML(html: string): ProseMirrorNode {
  const template = document.createElement("template");
  template.innerHTML = html;
  return ProseMirrorDOMParser.fromSchema(gfmSchema).parse(template.content);
}
