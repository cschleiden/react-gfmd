import { InputRule } from "@handlewithcare/prosemirror-inputrules";
import { gfmSchema } from "../../schema";
import { isAlertKind } from "./model";

export function createAlertInputRule() {
  return new InputRule(
    /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s$/i,
    (state, match, start, end) => {
      const kind = match[1]?.toLowerCase();
      if (!isAlertKind(kind)) return null;

      const { $from } = state.selection;
      for (let depth = $from.depth; depth > 0; depth -= 1) {
        if ($from.node(depth).type !== gfmSchema.nodes.blockquote) continue;
        if ($from.depth !== depth + 1 || $from.index(depth) !== 0) return null;

        return state.tr
          .setNodeMarkup($from.before(depth), gfmSchema.nodes.alert, { kind })
          .delete(start, end);
      }
      return null;
    },
  );
}
