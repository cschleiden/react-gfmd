import {
  markTypeInputRule,
  textblockTypeInputRule,
  wrappingInputRule,
} from "@handlewithcare/prosemirror-inputrules";
import { createAlertInputRule } from "../features/alerts/input-rules";
import { createEmojiShortcodeInputRule } from "../features/emoji";
import { createListInputRules } from "../lists/input-rules";
import { gfmSchema } from "../schema";

export function createMarkdownInputRules() {
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
