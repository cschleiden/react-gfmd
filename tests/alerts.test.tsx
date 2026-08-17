import { fireEvent, render, screen } from "@testing-library/react";
import { undo } from "prosemirror-history";
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  alertKinds,
  createGFMarkdownState,
  GFMarkdownEditor,
  parseHTML,
  parseMarkdown,
  setAlert,
  serializeMarkdown,
} from "../src";
import { GFMarkdownToolbar } from "../src/toolbar";

const context = { owner: "cschleiden", repo: "react-gfmd" };

describe("GitHub alerts", () => {
  it.each(alertKinds)("round-trips %s alerts semantically and converges", (kind) => {
    const markdown = `> [!${kind.toUpperCase()}]\n> **Formatted** content.`;
    const original = parseMarkdown(markdown);
    const alert = original.firstChild!;

    expect(alert.type.name).toBe("alert");
    expect(alert.attrs.kind).toBe(kind);
    expect(alert.firstChild?.textContent).toBe("Formatted content.");

    const serialized = serializeMarkdown(original);
    const reparsed = parseMarkdown(serialized);
    expect(reparsed.toJSON()).toEqual(original.toJSON());
    expect(serializeMarkdown(reparsed)).toBe(serialized);
  });

  it("preserves multi-block alerts inside their owning list item", () => {
    const markdown = `- Parent
  > [!WARNING]
  > First paragraph.
  >
  > - Nested item

- Sibling`;
    const original = parseMarkdown(markdown);
    const serialized = serializeMarkdown(original);
    const reparsed = parseMarkdown(serialized);
    const firstItem = reparsed.firstChild?.firstChild;

    expect(reparsed.toJSON()).toEqual(original.toJSON());
    expect(firstItem?.child(1).type.name).toBe("alert");
    expect(firstItem?.child(1).lastChild?.type.name).toBe("bullet_list");
    expect(reparsed.firstChild?.childCount).toBe(2);
  });

  it.each([
    "> [!UNKNOWN]\n> Keep this quote.",
    "> [!NOTE] This stays a quote.",
    "> Intro\n> [!NOTE]\n> Not first.",
  ])("keeps unsupported alert-like syntax as a blockquote: %s", (markdown) => {
    const doc = parseMarkdown(markdown);

    expect(doc.firstChild?.type.name).toBe("blockquote");
    expect(serializeMarkdown(parseMarkdown(serializeMarkdown(doc)))).toBe(
      serializeMarkdown(doc),
    );
  });

  it("renders accessible editable alerts for every GitHub type", () => {
    const value = alertKinds
      .map((kind) => `> [!${kind.toUpperCase()}]\n> ${kind} body`)
      .join("\n\n");

    render(<GFMarkdownEditor context={context} toolbar={false} value={value} />);

    const alerts = screen.getAllByRole("note");
    expect(alerts).toHaveLength(5);
    expect(alerts.map((alert) => alert.getAttribute("data-alert-kind"))).toEqual(
      alertKinds,
    );
    expect(document.querySelectorAll(".gfmd-alert-icon")).toHaveLength(5);
    for (const kind of alertKinds) {
      expect(screen.getByText(`${kind} body`)).toBeTruthy();
    }
  });

  it("parses GitHub-rendered alert HTML without duplicating its title", () => {
    const doc = parseHTML(`<div class="markdown-alert markdown-alert-tip">
      <p class="markdown-alert-title"><svg></svg>Tip</p>
      <p>Use the structured editor.</p>
    </div>`);
    const alert = doc.firstChild!;

    expect(alert.type.name).toBe("alert");
    expect(alert.attrs.kind).toBe("tip");
    expect(alert.textContent).toBe("Use the structured editor.");
    expect(serializeMarkdown(doc)).toBe(
      "> [!TIP]\n> Use the structured editor.",
    );
  });

  it("converges when pasted GitHub alert HTML starts with a list", () => {
    const doc = parseHTML(`<div class="markdown-alert markdown-alert-note">
      <p class="markdown-alert-title">Note</p>
      <ul><li>First</li><li>Second</li></ul>
    </div>`);
    const serialized = serializeMarkdown(doc);
    const reparsed = parseMarkdown(serialized);

    expect(doc.firstChild?.firstChild?.type.name).toBe("bullet_list");
    expect(reparsed.toJSON()).toEqual(doc.toJSON());
    expect(serializeMarkdown(reparsed)).toBe(serialized);
  });

  it("creates and changes alerts from the toolbar as one undoable action", async () => {
    let state = createGFMarkdownState({ context, value: "Pay attention." });
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2)),
    );
    const view = editorView(() => state, (next) => {
      state = state.apply(next);
    });

    render(<GFMarkdownToolbar state={state} view={view} />);
    await act(async () => {
      fireEvent.click(screen.getByTitle("Alert"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Warning"));
    });

    expect(state.doc.firstChild?.type.name).toBe("alert");
    expect(state.doc.firstChild?.attrs.kind).toBe("warning");
    expect(serializeMarkdown(state.doc)).toBe(
      "> [!WARNING]\n> Pay attention.",
    );
    expect(undo(state, view.dispatch)).toBe(true);
    expect(serializeMarkdown(state.doc)).toBe("Pay attention.");
  });

  it("converts a typed marker inside a blockquote into an alert", () => {
    let state = createGFMarkdownState({ context, value: "" });
    state = typeText(state, "> [!CAUTION] ");

    expect(state.doc.firstChild?.type.name).toBe("alert");
    expect(state.doc.firstChild?.attrs.kind).toBe("caution");
    expect(state.doc.firstChild?.textContent).toBe("");
    expect(serializeMarkdown(state.doc)).toBe("> [!CAUTION]");
  });

  it("does not convert a marker typed after the first quote paragraph", () => {
    let state = createGFMarkdownState({
      context,
      value: "> First paragraph.\n>\n> Second paragraph.",
    });
    const secondParagraph = findTextPosition(state, "Second paragraph.");
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, secondParagraph)),
    );
    state = typeText(state, "[!NOTE] ");

    expect(state.doc.firstChild?.type.name).toBe("blockquote");
    expect(state.doc.textContent).toContain("[!NOTE] Second paragraph.");
  });

  it("does not partially convert a selection crossing a quote boundary", () => {
    let state = createGFMarkdownState({
      context,
      value: "> Quoted content.\n\nOutside content.",
    });
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(
          state.doc,
          findTextPosition(state, "Quoted"),
          findTextPosition(state, "Outside") + "Outside".length,
        ),
      ),
    );
    const original = state.doc.toJSON();

    expect(setAlert("important")(state, (transaction) => {
      state = state.apply(transaction);
    })).toBe(false);
    expect(state.doc.toJSON()).toEqual(original);
  });
});

function editorView(
  getState: () => EditorState,
  dispatch: (transaction: Transaction) => void,
) {
  return {
    get state() {
      return getState();
    },
    dispatch,
    focus: vi.fn(),
  } as unknown as EditorView;
}

function typeText(state: EditorState, text: string) {
  let currentState = state;

  for (const character of text) {
    let handled = false;
    const view = editorView(
      () => currentState,
      (transaction) => {
        currentState = currentState.apply(transaction);
      },
    );

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

function findTextPosition(state: EditorState, text: string) {
  let position = -1;
  state.doc.descendants((node, pos) => {
    if (position !== -1 || !node.isText) return;
    const offset = node.text?.indexOf(text) ?? -1;
    if (offset !== -1) position = pos + offset;
  });
  if (position === -1) throw new Error(`Could not find text: ${text}`);
  return position;
}
