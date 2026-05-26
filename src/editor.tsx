import { reactKeys } from "@handlewithcare/react-prosemirror";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { DOMParser as ProseMirrorDOMParser } from "prosemirror-model";
import { EditorState, type Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { EditorView as ProseMirrorEditorView } from "prosemirror-view";
import * as React from "react";
import type { CreateGFMarkdownStateOptions, GFMarkdownEditorProps } from "./editor-types";
import { AlertNodeView } from "./features/alerts";
import { MentionNodeView } from "./features/mentions";
import { ReferenceNodeView } from "./features/references";
import { parseMarkdown, serializeMarkdown } from "./markdown";
import { createSuggestionPlugin } from "./plugins/suggestions";
import { createTokenConversionPlugin } from "./plugins/token-conversion";
import { gfmSchema } from "./schema";

export type { CreateGFMarkdownStateOptions, GFMarkdownEditorProps } from "./editor-types";

export function createGFMarkdownState(options: CreateGFMarkdownStateOptions): EditorState {
  return EditorState.create({
    doc: parseMarkdown(options.value),
    schema: gfmSchema,
    plugins: createPlugins(options),
  });
}

export function GFMarkdownEditor(props: GFMarkdownEditorProps) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const latestProps = React.useRef(props);
  latestProps.current = props;

  React.useEffect(() => {
    if (!hostRef.current) return undefined;

    const state = createGFMarkdownState(props);
    const view = new ProseMirrorEditorView(hostRef.current, {
      state,
      nodeViews: createNodeViews(latestProps),
      dispatchTransaction(transaction) {
        const nextState = view.state.apply(transaction);
        view.updateState(nextState);
        if (transaction.docChanged) {
          latestProps.current.onChange?.(serializeMarkdown(nextState.doc), nextState.doc);
        }
      },
      attributes: {
        class: "gfmd-editor-surface",
        "data-placeholder": props.placeholder ?? "",
      },
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  return <div className={["gfmd-editor", props.className].filter(Boolean).join(" ")} ref={hostRef} />;
}

function createPlugins(options: CreateGFMarkdownStateOptions): Plugin[] {
  return [
    history(),
    reactKeys(),
    keymap({
      "Mod-z": undo,
      "Shift-Mod-z": redo,
      "Mod-y": redo,
      "Mod-b": toggleMark(gfmSchema.marks.strong),
      "Mod-i": toggleMark(gfmSchema.marks.em),
      "Mod-`": toggleMark(gfmSchema.marks.code),
    }),
    keymap(baseKeymap),
    inputRules({
      rules: [
        wrappingInputRule(/^>\s+\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s$/i, gfmSchema.nodes.alert, (match) => ({
          kind: match[1].toUpperCase(),
        })),
        textblockTypeInputRule(/^$/, gfmSchema.nodes.paragraph),
      ],
    }),
    createTokenConversionPlugin(),
    createSuggestionPlugin(options),
  ];
}

function createNodeViews(optionsRef: React.MutableRefObject<GFMarkdownEditorProps>) {
  return {
    alert: (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) =>
      new AlertNodeView(node, view, getPos),
    reference: (node: ProseMirrorNode) => new ReferenceNodeView(node, optionsRef),
    mention: (node: ProseMirrorNode) => new MentionNodeView(node, optionsRef),
  };
}

export function parseHTML(html: string): ProseMirrorNode {
  const template = document.createElement("template");
  template.innerHTML = html;
  return ProseMirrorDOMParser.fromSchema(gfmSchema).parse(template.content);
}
