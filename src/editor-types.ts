import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorContext } from "./types";

export interface GFMarkdownEditorProps {
  value: string;
  context: EditorContext;
  onChange?: (markdown: string, doc: ProseMirrorNode) => void;
  onChangeDebounceMs?: number;
  placeholder?: string;
  className?: string;
  toolbar?: boolean;
  toolbarClassName?: string;
  contextualToolbar?: boolean;
}

export interface CreateGFMarkdownStateOptions {
  value: string;
  context: EditorContext;
  onChange?: (markdown: string, doc: ProseMirrorNode) => void;
}
