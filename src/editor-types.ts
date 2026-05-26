import type { Node as ProseMirrorNode } from "prosemirror-model";
import type {
  EditorContext,
  MentionResolver,
  MentionSuggestionProvider,
  ReferenceResolver,
  ReferenceSuggestionProvider,
} from "./types";

export interface GFMarkdownEditorProps {
  value: string;
  context: EditorContext;
  onChange?: (markdown: string, doc: ProseMirrorNode) => void;
  referenceResolver?: ReferenceResolver;
  mentionResolver?: MentionResolver;
  referenceSuggestionProvider?: ReferenceSuggestionProvider;
  mentionSuggestionProvider?: MentionSuggestionProvider;
  placeholder?: string;
  className?: string;
}

export interface CreateGFMarkdownStateOptions {
  value: string;
  context: EditorContext;
  onChange?: (markdown: string, doc: ProseMirrorNode) => void;
  referenceResolver?: ReferenceResolver;
  mentionResolver?: MentionResolver;
  referenceSuggestionProvider?: ReferenceSuggestionProvider;
  mentionSuggestionProvider?: MentionSuggestionProvider;
}
