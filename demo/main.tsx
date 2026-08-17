import * as React from "react";
import { createRoot } from "react-dom/client";
import { GFMarkdownEditor } from "../src";
import "../src/styles.css";
import "./styles.css";

export const initialMarkdown = `# React GFMD playground

Edit this document in rich text, then inspect the Markdown output below. The examples exercise common Markdown, GFM, and GitHub-specific syntax without hiding the awkward edge cases.

## Write with familiar Markdown

Combine **strong text**, *emphasis*, ~~strikethrough~~, \`inline code\`, and [descriptive links](https://github.com). Escaped characters stay literal: \\*not italic\\* and \\\`not code\\\`.

Bare links and email addresses are recognized too: https://github.com and support@github.com.

## GitHub conversations

@monalisa Could you review the latest changes?

Track local work with #60, compare owner-qualified references like github/docs#21953, or link directly to pull requests:

- [react/react#28270](https://github.com/react/react/pull/28270)
- [nodejs/node#53725](https://github.com/nodejs/node/pull/53725)
- https://github.com/vitejs/vite/pull/20000

## Plan work with nested task lists

- [x] Define the editor schema
- [ ] Finish the editing experience
  - [x] Preserve checked states
  - [ ] Verify mixed list types
    1. Test ordered children
    2. Test a nested task
       - [ ] Keep every descendant attached
- [ ] Document supported GitHub extensions

## Exercise list structure

1. Prepare the release.
   - Summarize user-facing changes.
   - Ask @monalisa for review.
2. Validate the package.

   This second paragraph makes the ordered item loose.

   > Nested blocks must remain inside their owning list item.
3. Publish when every check passes.

100. An ordered list can start at one hundred.
     - Its nested bullet still belongs to the first item.

## Compare data in a table

| Feature | Status | Example |
|:--------|:------:|--------:|
| Inline marks | Ready | **bold** and *italic* |
| Task lists | Ready | \`- [x]\` |
| Pull requests | Editing | [React PR](https://github.com/react/react/pull/28270) |

## Quote context and call out details

> A regular blockquote can contain **formatted text**.
>
>> It can also nest without flattening its content.

> [!NOTE]
> Raw and rich modes should preserve the same document meaning.

> [!TIP]
> Use the toolbar for discoverability or type Markdown directly.

> [!IMPORTANT]
> Nested list items must remain children of the item that owns them.

> [!WARNING]
> Unsupported syntax should remain visible and editable as raw source.

> [!CAUTION]
> Rendering raw HTML requires an explicit sanitization policy.

## Add footnotes without losing context

The editor keeps short references close to the sentence[^round-trip] while definitions can contain richer Markdown.[^structured]

[^round-trip]: Switching between raw and rich editing should converge on stable Markdown.
[^structured]: A definition can include \`code\`, **emphasis**, and multiple lines.

    Its continuation remains part of the same footnote.

## Include code

\`\`\`ts
const markdown = editor.serialize();
const stable = editor.serialize(editor.parse(markdown));
\`\`\`

Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> to open a command menu.

## Preserve GitHub extensions

<details>
<summary>Inspect nested details</summary>

Markdown inside the disclosure stays **structured**.

<details>
<summary>Show the inner example</summary>

\`\`\`js
const message = "Nested details can contain code";
\`\`\`

</details>
</details>

Inline math such as $\\alpha + \\beta = \\gamma$ and display math remain available:

$$
E = mc^2
$$

## Keep images and raw HTML

![An Octocat smiling and raising a tentacle.](https://myoctocat.com/assets/images/base-octocat.svg)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://github.githubassets.com/assets/GitHub-Mark-Light-64px-8e89cbb.png">
  <img alt="GitHub logo" src="https://myoctocat.com/assets/images/base-octocat.svg">
</picture>

<div align="center">

**Markdown inside raw HTML should not disappear.**

</div>

<!-- This source comment should remain invisible in the rendered document. -->

## Check smaller syntax details

This sentence ends with a hard break.\\
This line starts immediately below it.

This sentence wraps with a soft break
without starting a new paragraph.

Use <sub>subscript</sub>, <sup>superscript</sup>, and <ins>inserted text</ins> when raw HTML is appropriate.

Color tokens remain code: \`#0969DA\`, \`rgb(9, 105, 218)\`, and \`hsl(212, 92%, 45%)\`.

Emoji shortcodes remain source text: :+1: :shipit: :tada: :rocket: :octocat:

<a name="round-trip"></a>
[Jump back to the round-trip anchor](#round-trip)
`;

function App() {
  const [markdown, setMarkdown] = React.useState(initialMarkdown);

  return (
    <main>
      <header>
        <h1>React GFMD</h1>
        <p>Edit rich text and inspect the Markdown source as it updates.</p>
      </header>
      <div className="demo-workspace">
        <section className="demo-pane">
          <h2>Rich editor</h2>
          <GFMarkdownEditor
            context={{ owner: "cschleiden", repo: "react-gfmd" }}
            onChange={setMarkdown}
            value={markdown}
          />
        </section>
        <section className="demo-pane">
          <h2>Raw Markdown</h2>
          <pre className="demo-markdown">{markdown}</pre>
        </section>
      </div>
    </main>
  );
}

const container = document.getElementById("root");
if (container) {
  const existingRoot = (
    globalThis as typeof globalThis & {
      __gfmdDemoRoot?: ReturnType<typeof createRoot>;
    }
  ).__gfmdDemoRoot;
  const root = existingRoot ?? createRoot(container);
  (
    globalThis as typeof globalThis & {
      __gfmdDemoRoot?: ReturnType<typeof createRoot>;
    }
  ).__gfmdDemoRoot = root;
  root.render(<App />);
}
