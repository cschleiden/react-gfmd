export { createGFMarkdownState, GFMarkdownEditor, parseHTML } from "./editor";
export { parseMarkdown, serializeMarkdown } from "./markdown";
export { gfmSchema } from "./schema";
export {
  footnoteDefinitions,
  insertFootnote,
  insertFootnoteReference,
  normalizeFootnoteIdentifier,
  renameFootnote,
} from "./features/footnotes";
export type { EditorContext } from "./types";
