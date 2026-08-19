import { inputRules } from "@handlewithcare/prosemirror-inputrules";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { DOMParser as ProseMirrorDOMParser } from "prosemirror-model";
import { EditorState, Plugin } from "prosemirror-state";
import { tableEditing } from "prosemirror-tables";
import {
  EditorView,
  type DirectEditorProps,
} from "prosemirror-view";
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
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const latestProps = React.useRef(props);
  latestProps.current = props;
  const lastAppliedValueRef = React.useRef(props.value);
  const lastAppliedContextRef = React.useRef(contextKey(props.context));
  const pendingChangeRef = React.useRef<PendingChange | null>(null);
  const [editorState, setEditorState] = React.useState<EditorState | null>(null);
  const [editorView, setEditorView] = React.useState<EditorView | null>(null);

  const clearPendingChange = React.useCallback(() => {
    const pending = pendingChangeRef.current;
    if (!pending) return;
    globalThis.clearTimeout(pending.timer);
    pendingChangeRef.current = null;
  }, []);

  const emitChange = React.useCallback(() => {
    const pending = pendingChangeRef.current;
    if (!pending) return;
    globalThis.clearTimeout(pending.timer);
    pendingChangeRef.current = null;

    const onChange = latestProps.current.onChange;
    if (!onChange) return;
    const markdown = serializeMarkdown(pending.doc);
    lastAppliedValueRef.current = markdown;
    onChange(markdown, pending.doc);
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

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const state = createGFMarkdownState(latestProps.current);
    // Keep the document on ProseMirror's incremental DOM renderer. React still
    // owns the toolbar and the isolated React roots mounted by custom node views.
    const view = new EditorView(host, {
      attributes: editorAttributes(latestProps.current),
      dispatchTransaction(transaction) {
        const nextState = view.state.apply(transaction);
        view.updateState(nextState);
        setEditorState(nextState);
        if (transaction.docChanged) scheduleChange(nextState.doc);
      },
      nodeViews: createNodeViews(latestProps),
      state,
    });
    const handleBlur = () => emitChange();
    view.dom.addEventListener("blur", handleBlur, true);

    viewRef.current = view;
    setEditorState(state);
    setEditorView(view);
    return () => {
      view.dom.removeEventListener("blur", handleBlur, true);
      emitChange();
      view.destroy();
      viewRef.current = null;
    };
  }, [emitChange, scheduleChange]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const nextContextKey = contextKey(props.context);
    if (
      props.value === lastAppliedValueRef.current &&
      nextContextKey === lastAppliedContextRef.current
    ) {
      return;
    }
    clearPendingChange();
    lastAppliedValueRef.current = props.value;
    lastAppliedContextRef.current = nextContextKey;
    const nextState = createGFMarkdownState(latestProps.current);
    view.updateState(nextState);
    setEditorState(nextState);
  }, [props.context.owner, props.context.repo, props.value]);

  React.useEffect(() => {
    viewRef.current?.setProps({
      attributes: editorAttributes(props),
    });
  }, [props.placeholder]);

  return (
    <div className={["gfmd-editor", props.className].filter(Boolean).join(" ")}>
      {props.toolbar !== false && editorView && editorState ? (
        <GFMarkdownToolbar
          className={props.toolbarClassName}
          state={editorState}
          view={editorView}
        />
      ) : null}
      <div ref={hostRef} />
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

function editorAttributes(
  props: Pick<GFMarkdownEditorProps, "placeholder">,
): NonNullable<DirectEditorProps["attributes"]> {
  return {
    class: "gfmd-editor-surface",
    "data-placeholder": props.placeholder ?? "",
  };
}

function createPlugins(options: CreateGFMarkdownStateOptions): Plugin[] {
  return [
    history(),
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
