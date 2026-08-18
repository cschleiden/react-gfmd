import {
  markTypeInputRule,
  textblockTypeInputRule,
  wrappingInputRule,
} from "@handlewithcare/prosemirror-inputrules";
import { createAlertInputRule } from "../features/alerts/input-rules";
import { createEmojiShortcodeInputRule } from "../features/emoji";
import { createProjectTokenInputRule } from "../features/references";
import { createListInputRules } from "../lists/input-rules";
import { gfmSchema } from "../schema";
import type { EditorContext } from "../types";

export function createMarkdownInputRules(context: EditorContext) {
  return [
    markTypeInputRule(/\*\*(?<content>[^*]+)\*\*$/d, gfmSchema.marks.strong),
    markTypeInputRule(/__(?<content>[^_]+)__$/d, gfmSchema.marks.strong),
    markTypeInputRule(
      /(?<prefix>^|[^*])\*(?<content>[^*]+)\*$/d,
      gfmSchema.marks.em,
    ),
    markTypeInputRule(
      /(?<prefix>^|[^_])_(?<content>[^_]+)_$/d,
      gfmSchema.marks.em,
    ),
    markTypeInputRule(/`(?<content>[^`]+)`$/d, gfmSchema.marks.code),
    createEmojiShortcodeInputRule(),
    createProjectTokenInputRule(context),
    textblockTypeInputRule(
      /^(#{1,6})\s$/,
      gfmSchema.nodes.heading,
      (match) => ({
        level: match[1].length,
      }),
    ),
    ...createListInputRules(),
    wrappingInputRule(/^>\s$/, gfmSchema.nodes.blockquote),
    createAlertInputRule(),
    textblockTypeInputRule(/^$/, gfmSchema.nodes.paragraph),
  ];
}
