import type { Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { parseMentionToken } from "../features/mentions";
import { parseReferenceToken } from "../features/references";
import { gfmSchema } from "../schema";

const tokenPluginKey = new PluginKey("gfmd-token-conversion");

export function createTokenConversionPlugin() {
  return new Plugin({
    key: tokenPluginKey,
    props: {
      handleTextInput(view, from, to, text) {
        if (!/\s/.test(text)) return false;
        const { $from } = view.state.selection;
        const parentText = $from.parent.textBetween(0, $from.parentOffset, "\0", "\0");
        const match = parentText.match(/(?:^|\s)((?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)|(?:GH-\d+)|(?:#\d+)|(?:@[A-Za-z0-9][A-Za-z0-9-]{0,38}))$/);
        if (!match) return false;

        const raw = match[1];
        const start = from - raw.length;
        const tr = view.state.tr.insertText(text, from, to);
        const parsed = parseInlineToken(raw);
        if (!parsed) return false;
        tr.replaceWith(start, from, parsed);
        view.dispatch(tr);
        return true;
      },
    },
  });
}

export function parseInlineToken(raw: string): ProseMirrorNode | undefined {
  return parseReferenceToken(gfmSchema, raw) ?? parseMentionToken(gfmSchema, raw);
}
