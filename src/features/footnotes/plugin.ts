import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { gfmSchema } from "../../schema";
import { normalizeFootnoteIdentifier } from "./commands";

export function createFootnotePlugin() {
  return new Plugin({
    props: {
      decorations(state) {
        const counts = new Map<string, number>();
        state.doc.descendants((node) => {
          if (node.type !== gfmSchema.nodes.footnote_reference) return true;
          const identifier = normalizeFootnoteIdentifier(
            String(node.attrs.identifier),
          );
          counts.set(identifier, (counts.get(identifier) ?? 0) + 1);
          return false;
        });

        const decorations: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type !== gfmSchema.nodes.footnote_definition) return true;
          const identifier = normalizeFootnoteIdentifier(
            String(node.attrs.identifier),
          );
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              "data-gfmd-footnote-reference-count": String(
                counts.get(identifier) ?? 0,
              ),
            }),
          );
          return false;
        });
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}
