import { InputRule } from "@handlewithcare/prosemirror-inputrules";
import { emojiShortcodeNode } from "./markdown";

export function createEmojiShortcodeInputRule() {
  return new InputRule(
    /(^|[^\w:])(:([+\-\w]+):)([^\w:])$/,
    (state, match, start) => {
      const prefix = match[1];
      const shortcode = match[2];
      const emoji = emojiShortcodeNode(match[3]);
      if (!emoji) return null;
      if ("*_~`".includes(match[4])) return null;

      const from = start + prefix.length;
      const to = from + shortcode.length;
      let inCode = false;
      state.doc.nodesBetween(from, to, (node) => {
        if (node.marks.some((mark) => mark.type.spec.code)) inCode = true;
      });
      if (inCode) return null;

      const replacedNode = state.doc.nodeAt(from);
      const marks = replacedNode?.isText ? replacedNode.marks : [];
      return state.tr.replaceWith(from, to, emoji.mark(marks));
    },
    { inCodeMark: false },
  );
}
