import { describe, expect, it } from "vitest";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { parseMarkdown } from "../../markdown";
import { gfmSchema } from "../../schema";
import { parseAlertBlock, serializeAlertBlock } from "./markdown";

describe("alerts feature", () => {
  it("parses alert block starts and quoted body", () => {
    const result = parseAlertBlock(gfmSchema, ["> [!TIP]", "> Use #1."], 0, (markdown) => {
      const doc = parseMarkdown(markdown);
      const nodes: ProseMirrorNode[] = [];
      doc.forEach((node) => nodes.push(node));
      return nodes;
    });

    expect(result?.nextIndex).toBe(2);
    expect(result?.node.type.name).toBe("alert");
    expect(result?.node.attrs.kind).toBe("TIP");
  });

  it("serializes alert blocks", () => {
    const alert = parseMarkdown("> [!WARNING]\n> Be careful.").firstChild!;

    expect(serializeAlertBlock(alert, (node) => node.textContent)).toBe("> [!WARNING]\n> Be careful.");
  });
});
