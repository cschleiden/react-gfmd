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

  it.each([
    "**a *b* c**",
    "*a **b** c*",
    "***both***",
    "**bold *inner*** and [**linked**](https://example.com)",
  ])(
    "preserves semantics and converges for overlapping marks: %s",
    (markdown) => {
      const originalDoc = parseMarkdown(markdown);
      const serialized = serializeMarkdown(originalDoc);
      const reparsedDoc = parseMarkdown(serialized);

      expect(reparsedDoc.toJSON()).toEqual(originalDoc.toJSON());
      expect(serializeMarkdown(reparsedDoc)).toBe(serialized);
    },
  );

  it.each([
    "[label](https://example.com/a\\(b\\) \"A title\")",
    "[relative](../docs/file.md#section) [anchor](#heading) [mail](mailto:user@example.com)",
    "<https://example.com/a?x=1&y=2>",
    "https://example.com/path?q=one",
    "<user@example.com>",
    "user@example.com",
    "[**bold** and *emphasized*](https://example.com)",
    "[](https://example.com \"Empty label\")",
    "[brackets \\[inside\\]](<docs/a b.md> 'Title')",
    "[broken](<unterminated)",
    "[missing destination](",
  ])("preserves link semantics and converges: %s", (markdown) => {
    const originalDoc = parseMarkdown(markdown);
    const serialized = serializeMarkdown(originalDoc);
    const reparsedDoc = parseMarkdown(serialized);

    expect(reparsedDoc.toJSON()).toEqual(originalDoc.toJSON());
    expect(serializeMarkdown(reparsedDoc)).toBe(serialized);
    expect(reparsedDoc.textContent).toBe(originalDoc.textContent);
  });

  it("preserves empty link destinations and titles", () => {
    const doc = parseMarkdown("Before [](../target \"Title\") after");
    const emptyLinks: Array<Record<string, unknown>> = [];
    doc.descendants((node) => {
      if (node.type.name === "empty_link") emptyLinks.push(node.attrs);
    });

    expect(emptyLinks).toEqual([{ href: "../target", title: "Title" }]);
    expect(serializeMarkdown(doc)).toBe("Before [](../target \"Title\") after");
  });

  it("keeps links inside nested lists, tables, and details structurally stable", () => {
    const markdown = `- outer
  - [nested](../nested "Nested")

| Link |
| ---- |
| [cell](#cell) |

<details>
<summary>[Summary](mailto:user@example.com)</summary>

[Body](https://example.com)

</details>`;
    const doc = parseMarkdown(markdown);
    const serialized = serializeMarkdown(doc);
    const reparsed = parseMarkdown(serialized);

    expect(reparsed.toJSON()).toEqual(doc.toJSON());
    expect(serializeMarkdown(reparsed)).toBe(serialized);
    expect(reparsed.firstChild?.firstChild?.lastChild?.type.name).toBe(
      "bullet_list",
    );
    expect(reparsed.child(1).type.name).toBe("table");
    expect(reparsed.child(2).type.name).toBe("details");
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

  it("preserves a raw HTML image nested inside a link", () => {
    const markdown =
      `[<img src="image.png" alt="Build">](https://example.com "Link")`;
    const doc = parseMarkdown(markdown);
    const image = doc.firstChild?.firstChild;

    expect(image?.type.name).toBe("image");
    expect(image?.marks.map((mark) => mark.type.name)).toEqual(["link"]);
    const serialized = serializeMarkdown(doc);
    expect(serialized).toBe(
      `[![Build](image.png)](https://example.com "Link")`,
    );
    expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
    expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
  });

  it("preserves unsupported block HTML as raw Markdown", () => {
    const markdown = "<!-- keep me -->";
    const doc = parseMarkdown(markdown);
    const serialized = serializeMarkdown(doc);

    expect(doc.firstChild?.type.name).toBe("raw_block");
    expect(serialized).toBe(markdown);
    expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
  });

  describe("unsupported raw HTML regions", () => {
    const structuredRegions = [
      {
        name: "Markdown body",
        markdown: `<div align="center">

**Markdown inside raw HTML should not disappear.**

</div>`,
        text: "Markdown inside raw HTML should not disappear.",
      },
      {
        name: "nested same-name containers and quoted tag-like attributes",
        markdown: `<DIV data-example="> <div>">

<div class='inner'>

Nested **Markdown**.

</div>

</div>`,
        text: "Nested Markdown.",
      },
      {
        name: "differently nested containers and comments",
        markdown: `<section>

<!-- preserved -->
<aside>

Body

</aside>

</section>`,
        text: "Body",
      },
      {
        name: "source that resembles supported inline syntax and empty tasks",
        markdown: `<div>

H<sub>2</sub>O

- [ ]

</div>`,
        text: "H2O",
      },
    ];

    it.each(structuredRegions)(
      "keeps Markdown structured inside $name",
      ({ markdown, text }) => {
        const doc = parseMarkdown(markdown);
        const serialized = serializeMarkdown(doc);
        let regionCount = 0;

        doc.descendants((node) => {
          if (node.attrs.kind === "html_region") regionCount += 1;
        });
        expect(regionCount).toBe(0);
        expect(doc.textContent).toContain(text);
        expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
        expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
      },
    );

    it("keeps raw-text element contents as one exact atomic block", () => {
      const markdown = `<script>
if (left < right) value = "</not-a-close>";
</script>`;
      const doc = parseMarkdown(markdown);

      expect(doc.childCount).toBe(1);
      expect(doc.firstChild?.attrs).toMatchObject({
        kind: "html_region",
        tagName: "script",
        malformed: false,
        value: markdown,
      });
      expect(serializeMarkdown(doc)).toBe(markdown);
    });

    it.each([
      {
        name: "mismatched inner close",
        markdown: `<div>

<span>

Body

</div>`,
      },
      {
        name: "unclosed container",
        markdown: `<div>

Body without a close

## Still opaque`,
      },
    ])("preserves $name through the containing block scope", ({ markdown }) => {
      const doc = parseMarkdown(markdown);

      expect(doc.childCount).toBe(1);
      expect(doc.firstChild?.attrs).toMatchObject({
        kind: "html_region",
        tagName: "div",
        malformed: true,
        value: markdown,
      });
      expect(serializeMarkdown(doc)).toBe(markdown);
      expect(parseMarkdown(serializeMarkdown(doc)).toJSON()).toEqual(doc.toJSON());
    });

    it("keeps adjacent balanced regions separate", () => {
      const markdown = `<div>

First

</div>

<section>

Second

</section>`;
      const doc = parseMarkdown(markdown);

      expect(doc.childCount).toBe(2);
      expect(doc.textContent).toBe("FirstSecond");
      expect(
        doc.children.filter(
          (node) => node.type.name === "html_block_container",
        ),
      ).toHaveLength(2);
      expect(serializeMarkdown(doc)).toBe(markdown);
    });

    it("separates adjacent regions that share one mdast HTML node", () => {
      const markdown = "<div>First</div><section>Second</section>";
      const doc = parseMarkdown(markdown);

      expect(doc.childCount).toBe(2);
      expect(doc.child(0).attrs).toMatchObject({
        kind: "html_region",
        tagName: "div",
        value: "<div>First</div>",
      });
      expect(doc.child(1).attrs).toMatchObject({
        kind: "html_region",
        tagName: "section",
        value: "<section>Second</section>",
      });
      expect(serializeMarkdown(doc)).toBe(
        "<div>First</div>\n\n<section>Second</section>",
      );
    });

    it("does not discard trailing HTML when an image tag is not standalone", () => {
      const markdown = `<img src="https://example.com/image.png"><div>Body</div>`;
      const doc = parseMarkdown(markdown);
      const serialized = serializeMarkdown(doc);

      expect(serialized).toContain("![](https://example.com/image.png)");
      expect(serialized).toContain("<div>Body</div>");
      expect(parseMarkdown(serialized).textContent).toContain("Body");
    });

    it.each([
      "<img src=\"https://example.com/image.png\">",
      "<hr>",
      "<custom-element />",
      "<!-- standalone comment -->",
    ])("does not aggregate standalone void, self-closing, or comment HTML: %s", (markdown) => {
      const doc = parseMarkdown(markdown);

      expect(doc.childCount).toBe(1);
      expect(doc.firstChild?.attrs.kind).not.toBe("html_region");
      expect(serializeMarkdown(doc)).toBe(
        markdown.startsWith("<img")
          ? "![](https://example.com/image.png)"
          : markdown,
      );
    });

    it("keeps Markdown structured inside block HTML in a list item", () => {
      const markdown = `- before

  <div class="note">

  **inside**

  </div>

- after`;
      const doc = parseMarkdown(markdown);
      const firstItem = doc.firstChild?.firstChild;

      const container = firstItem?.lastChild;
      expect(container?.type.name).toBe("html_block_container");
      expect(container?.textContent).toBe("inside");
      expect(container?.firstChild?.firstChild?.marks[0]?.type.name).toBe(
        "strong",
      );
      const serialized = serializeMarkdown(doc);
      expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
      expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
    });

    it("keeps tab-indented Markdown structured inside block HTML", () => {
      const markdown = "-\t<div>\n\n\tbody\n\n\t</div>";
      const doc = parseMarkdown(markdown);
      const item = doc.firstChild?.firstChild;

      expect(item?.textContent).toBe("body");
      expect(item?.lastChild?.type.name).toBe("html_block_container");
      const serialized = serializeMarkdown(doc);
      expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
      expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
    });

    it("keeps mixed-indentation Markdown inside block HTML", () => {
      const markdown = "-\t<div>\n\n\tbody\n\n    </div>";
      const doc = parseMarkdown(markdown);
      const item = doc.firstChild?.firstChild;

      expect(item?.textContent).toBe("body");
      expect(item?.lastChild?.type.name).toBe("html_block_container");
      const serialized = serializeMarkdown(doc);
      expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
      expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
    });

    it("keeps HTML containers structurally inside their list item", () => {
      const markdown = `- <div>

  body

  </div>`;
      const doc = parseMarkdown(markdown);
      const serialized = serializeMarkdown(doc);
      const reparsed = parseMarkdown(serialized);

      expect(doc.firstChild?.type.name).toBe("bullet_list");
      expect(doc.firstChild?.firstChild?.lastChild?.type.name).toBe(
        "html_block_container",
      );
      expect(reparsed.toJSON()).toEqual(doc.toJSON());
      expect(serializeMarkdown(reparsed)).toBe(serialized);
    });

    it("keeps trailing text from one mdast HTML block opaque and convergent", () => {
      const markdown = `- <div>
  body
  </div>
  after`;
      const doc = parseMarkdown(markdown);
      const region = doc.firstChild?.firstChild?.lastChild;
      const serialized = serializeMarkdown(doc);

      expect(region?.type.name).toBe("raw_block");
      expect(region?.attrs.value).toContain("after");
      expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
      expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
    });

    it("keeps Markdown structured inside block HTML in a blockquote", () => {
      const markdown = `> <div>
>
> Quoted **Markdown**
>
> </div>`;
      const doc = parseMarkdown(markdown);
      const quote = doc.firstChild;

      expect(quote?.childCount).toBe(1);
      expect(quote?.firstChild?.type.name).toBe("html_block_container");
      expect(quote?.firstChild?.textContent).toBe("Quoted Markdown");
      expect(
        quote?.firstChild?.firstChild?.child(1).marks[0]?.type.name,
      ).toBe("strong");
      const serialized = serializeMarkdown(doc);
      expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
      expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
    });

    it("preserves blockquote content after a nested closing tag", () => {
      const markdown = `<div>

> inside
>
> </div>
>
> after`;
      const doc = parseMarkdown(markdown);
      const serialized = serializeMarkdown(doc);

      expect(doc.childCount).toBe(2);
      expect(doc.firstChild?.attrs).toMatchObject({
        kind: "html",
        value: "<div>",
      });
      expect(doc.lastChild?.type.name).toBe("blockquote");
      expect(doc.lastChild?.textContent).toBe("insideafter");
      expect(serialized).toContain("after");
      expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
      expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
    });

    it("keeps unsupported inline HTML as separate raw_inline boundaries", () => {
      const markdown = "Before <span>**rich**</span> after.";
      const doc = parseMarkdown(markdown);
      const rawValues: string[] = [];

      doc.descendants((node) => {
        if (node.type.name === "raw_inline") rawValues.push(node.attrs.value);
      });

      expect(rawValues).toEqual(["<span>", "</span>"]);
      expect(serializeMarkdown(doc)).toBe(markdown);
    });

    it("ends a block region at a closing tag parsed inside a paragraph", () => {
      const markdown = `<div>

text </div> after

# outside`;
      const doc = parseMarkdown(markdown);

      expect(doc.childCount).toBe(3);
      expect(doc.child(0).attrs).toMatchObject({
        kind: "html",
        value: "<div>",
      });
      expect(doc.child(1).textContent).toBe("text  after");
      expect(doc.child(1).child(1).attrs.value).toBe("</div>");
      expect(doc.child(2).type.name).toBe("heading");
      const serialized = serializeMarkdown(doc);
      expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
      expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
    });

    it("preserves trailing source when a closing tag is nested in inline markup", () => {
      const markdown = `<div>

*text </div> after*

# outside`;
      const doc = parseMarkdown(markdown);
      const serialized = serializeMarkdown(doc);

      expect(doc.childCount).toBe(3);
      expect(doc.child(0).attrs.value).toBe("<div>");
      expect(doc.child(1).textContent).toBe("text  after");
      expect(doc.child(2).type.name).toBe("heading");
      expect(serialized).toContain(" after*");
      expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
      expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
    });

    it("does not treat preformatted HTML contents as raw text for pairing", () => {
      const markdown = `<div><pre></div></pre>

# outside`;
      const doc = parseMarkdown(markdown);

      expect(doc.childCount).toBe(3);
      expect(doc.child(0).attrs).toMatchObject({
        kind: "html_region",
        malformed: true,
        value: "<div><pre></div>",
      });
      expect(doc.child(1).attrs.value).toBe("</pre>");
      expect(doc.child(2).type.name).toBe("heading");
    });

    it.each(["- \\[ ]", "- \\[x]"])(
      "does not reinterpret escaped task syntax: %s",
      (markdown) => {
        const doc = parseMarkdown(markdown);

        expect(doc.firstChild?.firstChild?.type.name).toBe("list_item");
        expect(serializeMarkdown(doc)).toBe(markdown);
      },
    );

    it("does not intercept supported details blocks", () => {
      const markdown = `<details>
<summary>Summary</summary>

Body

</details>`;
      const doc = parseMarkdown(markdown);

      expect(doc.firstChild?.type.name).toBe("details");
      expect(serializeMarkdown(doc)).toBe(markdown);
    });
  });

  it("preserves unsupported inline HTML as raw Markdown", () => {
    const markdown =
      "Use <custom-element data-value=\"1\">content</custom-element>.";
    const doc = parseMarkdown(markdown);
    const rawValues: string[] = [];
    doc.descendants((node) => {
      if (node.type.name === "raw_inline") rawValues.push(node.attrs.value);
    });

    expect(rawValues.length).toBeGreaterThan(0);
    expect(serializeMarkdown(doc)).toBe(markdown);
  });

  it("keeps HTML images without a source as raw Markdown", () => {
    const markdown = "<img alt=\"Missing source\">";
    const doc = parseMarkdown(markdown);

    expect(doc.firstChild?.type.name).toBe("raw_block");
    expect(serializeMarkdown(doc)).toBe(markdown);
  });

  it("round-trips subscript and superscript", () => {
    const markdown = "H<sub>2</sub>O and x<sup>2</sup>";

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("supports safe GitHub inline HTML semantics", () => {
    const markdown =
      '<ins cite="change" datetime="2026-08-17">new</ins> <mark>highlight</mark> <kbd>Ctrl</kbd> <samp>output</samp> <var>x</var> <q cite="source">quote</q> <tt>mono</tt>';
    const doc = parseMarkdown(markdown);
    const serialized = serializeMarkdown(doc);
    const marks = new Set<string>();

    doc.descendants((node) => {
      node.marks.forEach((mark) => marks.add(mark.type.name));
    });

    expect(marks).toEqual(
      new Set([
        "highlight",
        "insert",
        "keyboard_input",
        "quote",
        "sample_output",
        "teletype",
        "variable",
      ]),
    );
    expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
    expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
  });

  it("keeps safe inline wrappers opaque when nested HTML is unsafe", () => {
    const markdown =
      'Press <kbd><a href="javascript:alert(1)">Ctrl</a></kbd>.';
    const doc = parseMarkdown(markdown);
    const rawValues: string[] = [];

    doc.descendants((node) => {
      if (node.type.name === "raw_inline") rawValues.push(node.attrs.value);
    });

    expect(rawValues).toEqual([
      '<a href="javascript:alert(1)">',
      "</a>",
    ]);
    expect(serializeMarkdown(doc)).toBe(markdown);
  });

  it("supports safe div and section containers with Markdown children", () => {
    const markdown = `<div id="hero" align="center" class="not-rendered">

**Body**

<section lang="en">

# Heading

</section>

</div>`;
    const doc = parseMarkdown(markdown);
    const container = doc.firstChild;
    const nested = container?.lastChild;

    expect(container?.type.name).toBe("html_block_container");
    expect(container?.attrs).toMatchObject({
      attrs: { align: "center", id: "hero" },
      tagName: "div",
    });
    expect(nested?.type.name).toBe("html_block_container");
    expect(nested?.attrs).toMatchObject({
      attrs: { lang: "en" },
      tagName: "section",
    });
    expect(serializeMarkdown(doc)).toBe(markdown);
    expect(parseMarkdown(serializeMarkdown(doc)).toJSON()).toEqual(doc.toJSON());
  });

  it("supports definition lists with inline semantics", () => {
    const markdown = `<dl>
<dt>Term</dt>
<dd>Definition with <strong>strength</strong></dd>
</dl>`;
    const doc = parseMarkdown(markdown);
    const serialized = serializeMarkdown(doc);

    expect(doc.firstChild?.type.name).toBe("definition_list");
    expect(doc.firstChild?.firstChild?.type.name).toBe("definition_term");
    expect(doc.firstChild?.lastChild?.type.name).toBe(
      "definition_description",
    );
    expect(doc.firstChild?.lastChild?.textContent).toBe(
      "Definition with strength",
    );
    expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
    expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
  });

  it("supports safe picture sources with an image fallback", () => {
    const markdown = `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="dark.png">
  <img src="light.png" alt="Theme-aware logo" width="64">
</picture>`;
    const doc = parseMarkdown(markdown);

    expect(doc.firstChild?.type.name).toBe("picture");
    expect(doc.firstChild?.attrs).toMatchObject({
      image: {
        alt: "Theme-aware logo",
        src: "light.png",
        width: "64",
      },
      sources: [
        {
          media: "(prefers-color-scheme: dark)",
          srcset: "dark.png",
        },
      ],
    });
    expect(serializeMarkdown(doc)).toBe(markdown);
    expect(parseMarkdown(serializeMarkdown(doc)).toJSON()).toEqual(doc.toJSON());
  });

  it("keeps pictures with unsafe sources opaque", () => {
    const markdown = `<picture>
  <img src="javascript:alert(1)" alt="Unsafe">
</picture>`;
    const doc = parseMarkdown(markdown);

    expect(doc.firstChild?.type.name).toBe("raw_block");
    expect(serializeMarkdown(doc)).toBe(markdown);
  });

  it.each([
    "# H<sub>2</sub>O",
    "[H<sub>2</sub>O](https://example.com)",
    "| Formula |\n| ------- |\n| H<sub>2</sub>O |",
  ])("keeps inline HTML marks editable in every phrasing parent: %s", (markdown) => {
    const doc = parseMarkdown(markdown);
    const serialized = serializeMarkdown(doc);
    let subscriptCount = 0;

    doc.descendants((node) => {
      subscriptCount += node.marks.filter(
        (mark) => mark.type.name === "subscript",
      ).length;
    });

    expect(subscriptCount).toBe(1);
    expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
    expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
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

  it("preserves empty task items through serialization", () => {
    const markdown = "- [ ]";
    const doc = parseMarkdown(markdown);
    const serialized = serializeMarkdown(doc);

    expect(doc.firstChild?.firstChild?.type.name).toBe("task_list_item");
    expect(serialized).toBe(markdown);
    expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
  });

  it("round-trips footnotes through remark-gfm", () => {
    const markdown = `See note[^1].

[^1]: Footnote body.`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("stably places footnote definitions after editable document content", () => {
    const markdown = `[^first]: First definition.

Body[^first].

[^second]: Second definition.

Trailing body[^second].`;
    const doc = parseMarkdown(markdown);
    const serialized = serializeMarkdown(doc);

    expect(
      doc.children.map((node) => node.type.name),
    ).toEqual([
      "paragraph",
      "paragraph",
      "footnote_definition",
      "footnote_definition",
    ]);
    expect(serialized).toBe(`Body[^first].

Trailing body[^second].

[^first]: First definition.

[^second]: Second definition.`);
    expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
    expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
  });

  it("keeps Markdown structured inside block HTML in a footnote definition", () => {
    const markdown = `See note[^raw].

[^raw]: <div class="note">

    **opaque footnote Markdown**

    </div>`;
    const doc = parseMarkdown(markdown);
    const definition = doc.lastChild;

    expect(definition?.type.name).toBe("footnote_definition");
    expect(definition?.childCount).toBe(1);
    expect(definition?.firstChild?.type.name).toBe("html_block_container");
    expect(definition?.firstChild?.textContent).toBe(
      "opaque footnote Markdown",
    );
    expect(
      definition?.firstChild?.firstChild?.firstChild?.marks[0]?.type.name,
    ).toBe("strong");
    const serialized = serializeMarkdown(doc);
    expect(parseMarkdown(serialized).toJSON()).toEqual(doc.toJSON());
    expect(serializeMarkdown(parseMarkdown(serialized))).toBe(serialized);
  });

  it("preserves footnote semantics and converges with multiple references and blocks", () => {
    const markdown = `First[^Long-note] and again[^Long-note].

- Adjacent list item
  - Nested reference[^Long-note]

[^Long-note]: A **formatted** paragraph.

    A second paragraph.

    - Nested definition content`;
    const doc = parseMarkdown(markdown);
    const serialized = serializeMarkdown(doc);
    const reparsed = parseMarkdown(serialized);

    expect(reparsed.toJSON()).toEqual(doc.toJSON());
    expect(serializeMarkdown(reparsed)).toBe(serialized);

    const references: string[] = [];
    let definitionBlocks = 0;
    doc.descendants((node) => {
      if (node.type.name === "footnote_reference") {
        references.push(node.attrs.identifier);
      }
      if (node.type.name === "footnote_definition") {
        definitionBlocks = node.childCount;
      }
    });
    expect(references).toEqual(["long-note", "long-note", "long-note"]);
    expect(definitionBlocks).toBe(3);
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

  it.each([
`- outer
  1. ordered
 - deep
  - sibling
- tail`,
`- [ ] parent
  - [x] child
1. grandchild`,
`1. parent
   - bullet
 3. nested start
2. tail`,
`- first paragraph

  second paragraph

  > quote

- next`,
  ])("preserves nested list semantics and converges: %s", (markdown) => {
const originalDoc = parseMarkdown(markdown);
const serialized = serializeMarkdown(originalDoc);
const reparsedDoc = parseMarkdown(serialized);

expect(reparsedDoc.toJSON()).toEqual(originalDoc.toJSON());
expect(serializeMarkdown(reparsedDoc)).toBe(serialized);
  });

  it("preserves item-level spread in loose nested lists", () => {
const markdown = `- compact
- first paragraph

  second paragraph
- compact again`;
const doc = parseMarkdown(markdown);
const list = doc.firstChild;

expect(list?.type.name).toBe("bullet_list");
expect(list?.child(0).attrs.spread).toBe(false);
expect(list?.child(1).attrs.spread).toBe(true);
expect(list?.child(2).attrs.spread).toBe(false);

const reparsed = parseMarkdown(serializeMarkdown(doc));
expect(reparsed.toJSON()).toEqual(doc.toJSON());
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

  it("round-trips details blocks with markdown body content", () => {
    const markdown = `<details>
<summary>More info</summary>

This is **markdown**.

- item

</details>`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("preserves open details blocks and inline summary markdown", () => {
    const markdown = `<details open>
<summary>**More** info</summary>

Body

</details>`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("handles inline HTML in details summaries without aborting parsing", () => {
    const markdown = `<details>
<summary><code>npm install</code> instructions</summary>

Body

</details>`;
    const doc = parseMarkdown(markdown);

    const summaryRawValues: string[] = [];
    doc.firstChild?.firstChild?.descendants((node) => {
      if (node.type.name === "raw_inline") {
        summaryRawValues.push(node.attrs.value);
      }
    });
    expect(summaryRawValues).toEqual(["<code>", "</code>"]);
    expect(serializeMarkdown(doc)).toBe(`<details>
<summary><code>npm install</code> instructions</summary>

Body

</details>`);
  });

  it("supports details blocks without an explicit summary", () => {
    const markdown = `<details>

# Hello

Body

</details>`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("supports nested details blocks when remark combines closing tags", () => {
    const markdown = `<details>
<summary>Outer collapse</summary>

<details>
<summary>Inner collapse</summary>

\`\`\`js
const x = "code inside nested details";
\`\`\`

</details>

</details>`;

    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("preserves malformed details blocks as raw Markdown", () => {
    const markdown = `<details>

Body without a close`;

    const doc = parseMarkdown(markdown);
    expect(doc.firstChild?.type.name).toBe("raw_block");
    expect(serializeMarkdown(doc)).toBe(markdown);
  });
});
