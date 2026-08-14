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
    doc: parseMarkdown(options.value),
    schema: gfmSchema,
    plugins: createPlugins(options),
  });
}

export function GFMarkdownEditor(props: GFMarkdownEditorProps) {
  const latestProps = React.useRef(props);
  latestProps.current = props;
  const lastAppliedValueRef = React.useRef(props.value);

  const [editorState, setEditorState] = React.useState<EditorState>(() =>
    createGFMarkdownState(props),
  );
  const [editorView, setEditorView] = React.useState<EditorView | null>(null);
  const nodeViews = React.useMemo(() => createNodeViews(latestProps), []);

  React.useEffect(() => {
    if (props.value === lastAppliedValueRef.current) return;
    lastAppliedValueRef.current = props.value;
    setEditorState(createGFMarkdownState(latestProps.current));
  }, [props.value]);

  const dispatchTransaction = React.useCallback((transaction: Transaction) => {
    setEditorState((state) => {
      const nextState = state.apply(transaction);
      if (transaction.docChanged) {
        lastAppliedValueRef.current = serializeMarkdown(nextState.doc);
        latestProps.current.onChange?.(
          lastAppliedValueRef.current,
          nextState.doc,
        );
      }
      return nextState;
    });
  }, []);

  return (
    <div className={["gfmd-editor", props.className].filter(Boolean).join(" ")}>
      {props.toolbar !== false && editorView && editorState ? (
        <GFMarkdownToolbar
          className={props.toolbarClassName}
          state={editorState}
          view={editorView}
        />
      ) : null}
      <ProseMirror
        attributes={{
          class: "gfmd-editor-surface",
          "data-placeholder": props.placeholder ?? "",
        }}
        dispatchTransaction={dispatchTransaction}
        nodeViews={nodeViews}
        state={editorState}
      >
        <ProseMirrorDoc />
        <EditorViewObserver onViewChange={setEditorView} />
      </ProseMirror>
    </div>
  );
}

function EditorViewObserver({
  onViewChange,
}: {
  onViewChange: React.Dispatch<React.SetStateAction<EditorView | null>>;
}) {
  useEditorEffect(
    (view) => {
      onViewChange(view);
      return () => onViewChange(null);
    },
    [onViewChange],
  );

  return null;
}

function createPlugins(options: CreateGFMarkdownStateOptions): Plugin[] {
  return [
    history(),
    reactKeys(),
    createAutolinkPlugin(),
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
    createMarkdownClipboardPlugin(),
    createTaskListPlugin(),
    createFootnotePlugin(),
    inputRules({
      rules: createMarkdownInputRules(),
    }),
    createLinkInteractionPlugin(),
    tableEditing(),
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
