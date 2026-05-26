import { describe, expect, it } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../src";

describe("markdown", () => {
  it("parses empty markdown as an empty paragraph", () => {
    const doc = parseMarkdown("");

    expect(doc.childCount).toBe(1);
    expect(doc.firstChild?.type.name).toBe("paragraph");
    expect(serializeMarkdown(doc)).toBe("");
  });

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

  it("does not escape leading issue references", () => {
    expect(serializeMarkdown(parseMarkdown("#42 starts a paragraph."))).toBe("#42 starts a paragraph.");
  });

  it("round-trips common inline markdown", () => {
    const markdown = "**bold** *italic* `code` [link](https://example.com)";

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("round-trips common block markdown", () => {
    const markdown = `# Heading

> Quote

- one
- [x] done

1. ordered

\`\`\`ts
const value = 1;
\`\`\`

---`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("round-trips footnotes through remark-gfm", () => {
    const markdown = `See note[^1].

[^1]: Footnote body.`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("parses supported markdown inside alerts", () => {
    const markdown = `> [!TIP]
> Use **bold** text.
>
> - item`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("fails explicitly for unsupported GFM tables", () => {
    const markdown = `| A | B |
| - | - |
| 1 | 2 |`;

    expect(() => parseMarkdown(markdown)).toThrow(/GFM tables/);
  });
});
