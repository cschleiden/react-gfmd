import { render } from "@testing-library/react";
import type { EditorState, Transaction } from "prosemirror-state";
import { undo } from "prosemirror-history";
import type { EditorView } from "prosemirror-view";
import { act } from "react";
import { describe, expect, it } from "vitest";
import {
  createGFMarkdownState,
  GFMarkdownEditor,
  parseHTML,
  parseMarkdown,
  serializeMarkdown,
} from "../src";
import { parseMarkdownClipboardText } from "../src/clipboard";

const context = { owner: "cschleiden", repo: "react-gfmd" };

describe("GitHub mentions and project references", () => {
  it("parses mentions and references with project context", () => {
    const markdown =
      "Ask @monalisa and @github/docs about #60 and github/docs#21953.";
    const doc = parseMarkdown(markdown, context);
    const nodes = Array.from({ length: doc.firstChild!.childCount }, (_, index) =>
      doc.firstChild!.child(index),
    );

    expect(nodes.map((node) => node.type.name)).toEqual([
      "text",
      "github_mention",
      "text",
      "github_mention",
      "text",
      "github_reference",
      "text",
      "github_reference",
      "text",
    ]);
    expect(nodes[1].attrs).toMatchObject({
      source: "@monalisa",
      username: "monalisa",
      team: null,
    });
    expect(nodes[3].attrs).toMatchObject({
      source: "@github/docs",
      username: "github",
      team: "docs",
    });
    expect(nodes[5].attrs).toMatchObject({
      source: "#60",
      owner: context.owner,
      repo: context.repo,
      number: 60,
    });
    expect(nodes[7].attrs).toMatchObject({
      source: "github/docs#21953",
      owner: "github",
      repo: "docs",
      number: 21953,
    });
    expect(serializeMarkdown(doc)).toBe(markdown);
  });

  it("only resolves local references when project context is available", () => {
    const doc = parseMarkdown("@monalisa #60 github/docs#21953");

    expect(doc.firstChild?.child(0).type.name).toBe("github_mention");
    expect(doc.firstChild?.child(2).type.name).toBe("github_reference");
    expect(serializeMarkdown(doc)).toBe("@monalisa #60 github/docs#21953");
  });

  it("does not reinterpret code, explicit links, escaped tokens, or colors", () => {
    const markdown =
      "`@code #1` [@linked #2](https://example.com) \\@escaped #0969DA";
    const doc = parseMarkdown(markdown, context);
    const semanticNodes: string[] = [];
    doc.descendants((node) => {
      if (node.type.name.startsWith("github_")) semanticNodes.push(node.type.name);
    });

    expect(semanticNodes).toEqual([]);
    expect(serializeMarkdown(doc)).toBe(
      "`@code #1` [@linked #2](https://example.com) @escaped #0969DA",
    );
  });

  it("preserves semantics and converges through repeated serialization", () => {
    const markdown = "**@monalisa** owns #60; see github/docs#21953.";
    const first = parseMarkdown(markdown, context);
    const normalized = serializeMarkdown(first);
    const second = parseMarkdown(normalized, context);

    expect(second.toJSON()).toEqual(first.toJSON());
    expect(serializeMarkdown(second)).toBe(normalized);
  });

  it("renders safe GitHub destinations without changing source Markdown", () => {
    render(
      <GFMarkdownEditor
        context={context}
        toolbar={false}
        value="@monalisa @github/docs #60 github/docs#21953"
      />,
    );

    expect(
      document.querySelector<HTMLAnchorElement>("[data-gfmd-mention]")?.href,
    ).toBe("https://github.com/monalisa");
    expect(
      document.querySelectorAll<HTMLAnchorElement>("[data-gfmd-mention]")[1]
        .href,
    ).toBe("https://github.com/orgs/github/teams/docs");
    expect(
      document.querySelector<HTMLAnchorElement>("[data-gfmd-reference]")?.href,
    ).toBe("https://github.com/cschleiden/react-gfmd/issues/60");
  });

  it("parses GitHub-rendered mention and reference HTML", () => {
    const doc = parseHTML(`
      <p>
        <a class="user-mention" href="https://github.com/monalisa">@monalisa</a>
        <a class="issue-link" href="https://github.com/github/docs/pull/21953">github/docs#21953</a>
      </p>
    `);

    expect(doc.firstChild?.child(0).type.name).toBe("github_mention");
    expect(doc.firstChild?.child(2).type.name).toBe("github_reference");
    expect(serializeMarkdown(doc)).toBe("@monalisa github/docs#21953");
  });

  it("uses project context for Markdown clipboard parsing", () => {
    const slice = parseMarkdownClipboardText("Review #60 with @monalisa", context);
    const nodeNames: string[] = [];
    slice.content.descendants((node) => {
      nodeNames.push(node.type.name);
    });

    expect(nodeNames).toContain("github_reference");
    expect(nodeNames).toContain("github_mention");
  });

  it("re-resolves local references when controlled project context changes", async () => {
    const rendered = render(
      <GFMarkdownEditor context={context} toolbar={false} value="#60" />,
    );
    expect(
      document.querySelector<HTMLAnchorElement>("[data-gfmd-reference]")?.href,
    ).toBe("https://github.com/cschleiden/react-gfmd/issues/60");

    rendered.rerender(
      <GFMarkdownEditor
        context={{ owner: "github", repo: "docs" }}
        toolbar={false}
        value="#60"
      />,
    );
    await act(async () => {});

    expect(
      document.querySelector<HTMLAnchorElement>("[data-gfmd-reference]")?.href,
    ).toBe("https://github.com/github/docs/issues/60");
  });

  it("waits for a complete team mention before converting typed text", () => {
    const state = typeText(
      createGFMarkdownState({ context, value: "" }),
      "@github/docs ",
    );

    expect(state.doc.firstChild?.child(0).type.name).toBe("github_mention");
    expect(state.doc.firstChild?.child(0).attrs).toMatchObject({
      username: "github",
      team: "docs",
    });
  });

  it("converts typed mentions and references as undoable actions", () => {
    let state = typeText(
      createGFMarkdownState({ context, value: "" }),
      "@monalisa #60 ",
    );

    expect(state.doc.firstChild?.child(0).type.name).toBe("github_mention");
    expect(state.doc.firstChild?.child(2).type.name).toBe("github_reference");
    expect(serializeMarkdown(state.doc)).toBe("@monalisa #60&#x20;");
    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(
      state.doc.firstChild?.content.content.some(
        (node) => node.type.name === "github_reference",
      ),
    ).toBe(false);
    expect(serializeMarkdown(state.doc)).toBe("@monalisa #60&#x20;");
  });
});

function typeText(state: EditorState, text: string) {
  let currentState = state;

  for (const character of text) {
    let handled = false;
    const view = {
      composing: false,
      get state() {
        return currentState;
      },
      dispatch(transaction: Transaction) {
        currentState = currentState.apply(transaction);
      },
    } as unknown as EditorView;

    for (const plugin of currentState.plugins) {
      const handler = plugin.props.handleTextInput;
      if (
        handler?.call(
          plugin,
          view,
          currentState.selection.from,
          currentState.selection.to,
          character,
          () => currentState.tr.insertText(character),
        )
      ) {
        handled = true;
        break;
      }
    }

    if (!handled) {
      currentState = currentState.apply(currentState.tr.insertText(character));
    }
  }

  return currentState;
}
