import { describe, expect, it } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../src";

describe("markdown", () => {
  it("round-trips alerts", () => {
    const markdown = `> [!WARNING]
> Be careful with #123.
>
> Ping @monalisa.`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("parses bare, GH, cross-repo references and mentions", () => {
    const doc = parseMarkdown("Refs #1, GH-2, owner/repo#3, and @monalisa.");
    const paragraph = doc.firstChild!;
    const nodes: string[] = [];
    paragraph.forEach((node) => nodes.push(node.type.name));

    expect(nodes).toEqual([
      "text",
      "reference",
      "text",
      "reference",
      "text",
      "reference",
      "text",
      "mention",
      "text",
    ]);
    expect(serializeMarkdown(doc)).toBe("Refs #1, GH-2, owner/repo#3, and @monalisa.");
  });
});
