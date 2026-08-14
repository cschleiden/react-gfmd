export { createGFMarkdownState, GFMarkdownEditor, parseHTML } from "./editor";
export { parseMarkdown, serializeMarkdown } from "./markdown";
export { gfmSchema } from "./schema";
export {
  insertFootnote,
  normalizeFootnoteIdentifier,
  renameFootnote,
} from "./features/footnotes";
export type { EditorContext } from "./types";
