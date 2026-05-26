import "../src/styles.css";
import * as React from "react";
import { createRoot } from "react-dom/client";
import {
  GFMarkdownEditor,
  type GitHubMention,
  type GitHubReference,
  type MentionResolver,
  type ReferenceResolver,
} from "../src";
import "./styles.css";

const initialMarkdown = `# React GFMD demo

This editor round-trips common Markdown and GitHub-flavored Markdown while rendering #42, owner/repo#123, GH-9, and @monalisa as rich nodes.

## Inline formatting

Use **strong**, *emphasis*, ~~strikethrough~~, \`inline code\`, [links](https://github.com), bare URLs like https://github.com, and footnote references[^1].

## Lists and tasks

- Plain bullet item with #42
- [x] Completed task assigned to @monalisa
- [ ] Open task that mentions GH-9

1. Ordered item
2. Ordered item with owner/repo#123

## Quotes and alerts

> Blockquotes preserve nested inline features like **bold** text and @octocat.

> [!NOTE]
> GitHub alerts can include rich references like #42 and mentions like @monalisa.
>
> - Alerts can also contain nested Markdown.
> - Try editing this list and watch the Markdown output update.

> [!WARNING]
> Tables are intentionally not in this seed document yet because table nodes are not mapped to the ProseMirror schema.

## Code and rules

\`\`\`ts
const issue = "#42";
console.log(\`Resolved \${issue}\`);
\`\`\`

---

Try typing #42 or @monalisa followed by a space.

[^1]: Footnotes are parsed through remark-gfm and serialized back to Markdown.`;

const references = new Map<number, GitHubReference>([
  [
    42,
    {
      owner: "cschleiden",
      repo: "react-gfmd",
      number: 42,
      type: "issue",
      state: "open",
      title: "Ship the editor MVP",
      url: "https://github.com/cschleiden/react-gfmd/issues/42",
    },
  ],
  [
    123,
    {
      owner: "owner",
      repo: "repo",
      number: 123,
      type: "pull",
      state: "merged",
      title: "Add rich reference cards",
      url: "https://github.com/owner/repo/pull/123",
    },
  ],
  [
    9,
    {
      owner: "cschleiden",
      repo: "react-gfmd",
      number: 9,
      type: "pull",
      state: "closed",
      title: "Prototype mention chips",
      url: "https://github.com/cschleiden/react-gfmd/pull/9",
    },
  ],
]);

const referenceResolver: ReferenceResolver = {
  async resolveReference(ref, context) {
    return references.get(ref.number) ?? {
      owner: ref.owner ?? context.owner,
      repo: ref.repo ?? context.repo,
      number: ref.number,
      type: "issue",
      state: "unknown",
      title: "Unmocked reference",
      url: `https://github.com/${ref.owner ?? context.owner}/${ref.repo ?? context.repo}/issues/${ref.number}`,
    };
  },
};

const mentionResolver: MentionResolver = {
  async resolveMention(username) {
    const mention: GitHubMention = {
      username,
      displayName: username === "monalisa" ? "Mona Lisa" : undefined,
      avatarUrl: username === "monalisa" ? "https://github.com/monalisa.png" : undefined,
      url: `https://github.com/${username}`,
    };
    return mention;
  },
};

function App() {
  const [markdown, setMarkdown] = React.useState(initialMarkdown);

  return (
    <main>
      <header>
        <h1>React GFMD</h1>
        <p>Common Markdown, GFM features, GitHub alerts, references, and mentions as rich editable Markdown.</p>
      </header>
      <GFMarkdownEditor
        context={{ owner: "cschleiden", repo: "react-gfmd" }}
        mentionResolver={mentionResolver}
        mentionSuggestionProvider={{
          async searchMentions(query) {
            const username = query.replace(/^@/, "");
            return username
              ? [{ username, label: `@${username}`, detail: username === "monalisa" ? "Mona Lisa" : undefined }]
              : [];
          },
        }}
        onChange={setMarkdown}
        referenceResolver={referenceResolver}
        referenceSuggestionProvider={{
          async searchReferences(query) {
            const number = Number(query.match(/\d+/)?.[0]);
            if (!number) return [];
            const value = references.get(number) ?? (await referenceResolver.resolveReference({ number, raw: query }, { owner: "cschleiden", repo: "react-gfmd" }));
            return value
              ? [{ ref: { number: value.number, owner: value.owner, repo: value.repo, raw: query }, label: `#${value.number}`, detail: value.title, value }]
              : [];
          },
        }}
        value={markdown}
      />
      <section>
        <h2>Markdown</h2>
        <pre>{markdown}</pre>
      </section>
    </main>
  );
}

const container = document.getElementById("root")!;
const existingRoot = (globalThis as typeof globalThis & { __gfmdDemoRoot?: ReturnType<typeof createRoot> }).__gfmdDemoRoot;
const root = existingRoot ?? createRoot(container);
(globalThis as typeof globalThis & { __gfmdDemoRoot?: ReturnType<typeof createRoot> }).__gfmdDemoRoot = root;
root.render(<App />);
