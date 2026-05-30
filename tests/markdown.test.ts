import { describe, expect, it } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../src";

describe("markdown", () => {
  it("parses empty markdown as an empty paragraph", () => {
    const doc = parseMarkdown("");

    expect(doc.childCount).toBe(1);
    expect(doc.firstChild?.type.name).toBe("paragraph");
    expect(serializeMarkdown(doc)).toBe("");
  });

  it("keeps issue-like references as plain text", () => {
    const doc = parseMarkdown("Refs #1, GH-2, and owner/repo#3.");
    const paragraph = doc.firstChild!;
    const nodes: string[] = [];
    paragraph.forEach((node) => nodes.push(node.type.name));

    expect(nodes).toEqual(["text"]);
    expect(serializeMarkdown(doc)).toBe("Refs #1, GH-2, and owner/repo#3.");
  });

  it("does not escape leading issue references", () => {
    expect(serializeMarkdown(parseMarkdown("#42 starts a paragraph."))).toBe(
      "#42 starts a paragraph.",
    );
  });

  it("round-trips common inline markdown", () => {
    const markdown = "**bold** *italic* `code` [link](https://example.com)";

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("round-trips images", () => {
    const markdown = "![Alt text](https://example.com/image.png \"Title\")";

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("parses reference-style images", () => {
    const markdown = `![Alt text][img]

[img]: https://example.com/image.png "Title"`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(
      "![Alt text](https://example.com/image.png \"Title\")",
    );
  });

  it("parses raw HTML image tags", () => {
    const markdown = `<img src="https://example.com/image.png" alt="Alt text" title="Title">`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(
      "![Alt text](https://example.com/image.png \"Title\")",
    );
  });

  it("round-trips subscript and superscript", () => {
    const markdown = "H<sub>2</sub>O and x<sup>2</sup>";

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

  it("round-trips nested blockquotes", () => {
    const markdown = `> Outer
>
> > Inner
> >
> > Deep`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("supports mixed list style transitions", () => {
    const markdown = `1. foo
* bar
2. gr`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(`1. foo

- bar

2. gr`);
  });

  it("keeps adjacent GFM bullet and ordered lists separate", () => {
    const markdown = `* a
* b
1. c
2. d`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(`- a
- b

1. c
2. d`);
  });

  it("round-trips GFM tables", () => {
    const markdown = `| A | B |
| - | - |
| 1 | 2 |`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("round-trips GFM table alignment and inline formatting", () => {
    const markdown = `| Left | Center | Right |
| :--- | :----: | ----: |
| **A** | \`B\` | [C](https://example.com) |`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(`| Left  | Center |                    Right |
| :---- | :----: | -----------------------: |
| **A** |   \`B\`  | [C](https://example.com) |`);
  });
});
