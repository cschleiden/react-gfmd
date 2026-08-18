import { InputRule } from "@handlewithcare/prosemirror-inputrules";
import type { EditorContext } from "../../types";
import { projectNodeFromToken } from "./utils";

export function createProjectTokenInputRule(context: EditorContext) {
  return new InputRule(
    /(^|[^\w@/#])(@[A-Za-z0-9][A-Za-z0-9-]*(?:\/[A-Za-z0-9][A-Za-z0-9-]*)?|(?:(?:[A-Za-z0-9][A-Za-z0-9-]*)\/[A-Za-z0-9._-]+)?#[1-9]\d*)([^\w@/-])$/,
    (state, match, start) => {
      const prefix = match[1];
      const token = match[2];
      const node = projectNodeFromToken(token, context);
      if (!node) return null;

      const from = start + prefix.length;
      const to = from + token.length;
      let inCode = false;
      state.doc.nodesBetween(from, to, (candidate) => {
        if (candidate.marks.some((mark) => mark.type.spec.code)) inCode = true;
      });
      if (inCode) return null;

      const replacedNode = state.doc.nodeAt(from);
      const marks = replacedNode?.isText ? replacedNode.marks : [];
      return state.tr.replaceWith(from, to, node.mark(marks));
    },
    { inCodeMark: false },
  );
}
