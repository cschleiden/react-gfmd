import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { redo, undo } from "prosemirror-history";
import {
  NodeSelection,
  TextSelection,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createGFMarkdownState,
  GFMarkdownEditor,
  insertDetails,
  parseMarkdown,
  serializeMarkdown,
} from "../src";
import {
  parseMarkdownClipboardText,
  serializeMarkdownClipboardSlice,
} from "../src/clipboard";
import { GFMarkdownToolbar } from "../src/toolbar";
import {
  context,
  createEditorView,
  findTextPosition,
  pasteEvent,
  runCommand,
  withSelection,
} from "./list-test-helpers";

describe("details insertion", () => {
  it("inserts an editable, semantically stable block into an empty paragraph", () => {
    const state = runCommand(
      createGFMarkdownState({ context, value: "" }),
      insertDetails,
    );
    const details = state.doc.firstChild;

    expect(details?.type.name).toBe("details");
    expect(details?.attrs).toMatchObject({
      implicitSummary: false,
      open: false,
    });
    expect(details?.firstChild?.textContent).toBe("Details");
    expect(details?.lastChild?.type.name).toBe("paragraph");
    expect(details?.lastChild?.content.size).toBe(0);
    expect(state.selection).toBeInstanceOf(TextSelection);
    expect(state.doc.textBetween(state.selection.from, state.selection.to)).toBe(
      "Details",
    );
    expectStableRoundTrip(state);
  });

  it("moves selected blocks between surrounding siblings into the body", () => {
    let state = createGFMarkdownState({
      context,
      value: `Before

**Bold** body.

Second block.

After`,
    });
    const from = findTextPosition(state, "Bold");
    const to = findTextPosition(state, "Second block.") + "Second block.".length;
    state = withSelection(state, from, to);
    state = runCommand(state, insertDetails);

    expect(state.doc.childCount).toBe(3);
    expect(state.doc.child(0).textContent).toBe("Before");
    expect(state.doc.child(1).type.name).toBe("details");
    expect(state.doc.child(2).textContent).toBe("After");
    expect(state.doc.child(1).child(1).firstChild?.marks[0]?.type.name).toBe(
      "strong",
    );
    expect(state.doc.child(1).child(2).textContent).toBe("Second block.");
    expect(
      state.doc.textBetween(
        state.selection.from,
        state.selection.to,
        "\n\n",
      ),
    ).toBe("Bold body.\n\nSecond block.");
    expectStableRoundTrip(state);
  });

  it("does not move a synthetic empty paragraph from a block boundary", () => {
    let state = createGFMarkdownState({
      context,
      value: `A paragraph

Second paragraph`,
    });
    state = withSelection(
      state,
      findTextPosition(state, "A paragraph"),
      findTextPosition(state, "Second paragraph"),
    );
    state = runCommand(state, insertDetails);

    expect(state.doc.firstChild?.type.name).toBe("details");
    expect(state.doc.child(1).textContent).toBe("A paragraph");
    expect(state.doc.lastChild?.textContent).toBe("Second paragraph");
    expectStableRoundTrip(state);
  });

  it.each([
    {
      container: "list item",
      value: `- Parent

  **Body**

- Sibling`,
      containerType: "list_item",
      expectedSibling: "Sibling",
    },
    {
      container: "blockquote",
      value: `> Before
>
> **Body**
>
> After`,
      containerType: "blockquote",
      expectedSibling: "After",
    },
  ])(
    "preserves marked content and ownership inside a $container",
    ({ value, containerType, expectedSibling }) => {
      let state = createGFMarkdownState({ context, value });
      const from = findTextPosition(state, "Body");
      state = withSelection(state, from, from + "Body".length);
      state = runCommand(state, insertDetails);

      const details = findDescendant(state, "details");
      const container =
        containerType === "list_item"
          ? state.doc.firstChild?.firstChild
          : findDescendant(state, containerType);
      expect(details?.child(1).firstChild?.marks[0]?.type.name).toBe("strong");
      if (containerType === "list_item") {
        expect(container?.attrs.spread).toBe(true);
        expect(state.doc.firstChild?.attrs.tight).toBe(false);
        expect(state.doc.firstChild?.child(1).textContent).toBe(expectedSibling);
      } else {
        expect(container?.textContent).toContain(expectedSibling);
      }
      expectStableRoundTrip(state);
    },
  );

  it("loosens every affected ancestor when inserted in a nested list", () => {
    let state = createGFMarkdownState({
      context,
      value: `- Parent
  - Child
  - Nested sibling
- Tail`,
    });
    const from = findTextPosition(state, "Child");
    state = withSelection(state, from, from + "Child".length);
    state = runCommand(state, insertDetails);

    const outerList = state.doc.firstChild;
    const parentItem = outerList?.firstChild;
    const nestedList = parentItem?.lastChild;
    const childItem = nestedList?.firstChild;
    expect(outerList?.attrs.tight).toBe(false);
    expect(parentItem?.attrs.spread).toBe(true);
    expect(nestedList?.attrs.tight).toBe(false);
    expect(childItem?.attrs.spread).toBe(true);
    expect(childItem?.firstChild?.textContent).toBe("Child");
    expect(childItem?.lastChild?.type.name).toBe("details");
    expectStableRoundTrip(state);
  });

  it("avoids an empty leading paragraph at the start of a nested list item", () => {
    let state = createGFMarkdownState({
      context,
      value: `- One
- Two
  - Nested
- Three`,
    });
    state = withSelection(state, findTextPosition(state, "Two"));
    state = runCommand(state, insertDetails);

    const secondItem = state.doc.firstChild?.child(1);
    expect(secondItem?.firstChild?.textContent).toBe("Two");
    expect(secondItem?.child(1).type.name).toBe("details");
    expect(secondItem?.lastChild?.type.name).toBe("bullet_list");
    expectStableRoundTrip(state);
  });

  it("inserts outside a list when the selected item is empty", () => {
    let state = createGFMarkdownState({
      context,
      value: `- One
- `,
    });
    state = withSelection(state, findEmptyParagraphPosition(state));
    state = runCommand(state, insertDetails);

    expect(state.doc.firstChild?.type.name).toBe("bullet_list");
    expect(state.doc.firstChild?.child(1).textContent).toBe("");
    expect(state.doc.lastChild?.type.name).toBe("details");
    expectStableRoundTrip(state);
  });

  it("round-trips insertion inside a GitHub alert", () => {
    let state = createGFMarkdownState({
      context,
      value: `> [!NOTE]
> Alert body`,
    });
    const from = findTextPosition(state, "Alert body");
    state = withSelection(state, from, from + "Alert body".length);
    state = runCommand(state, insertDetails);

    expect(state.doc.firstChild?.type.name).toBe("alert");
    expect(state.doc.firstChild?.firstChild?.type.name).toBe("details");
    expectStableRoundTrip(state);
  });

  it("supports summary and empty body editing", () => {
    let state = runCommand(
      createGFMarkdownState({ context, value: "" }),
      insertDetails,
    );
    const summaryFrom = state.selection.from;
    const summaryTo = state.selection.to;
    state = state.apply(state.tr.insertText("More info", summaryFrom, summaryTo));
    const bodyFrom = state.doc.firstChild!.firstChild!.nodeSize + 2;
    state = state.apply(state.tr.insertText("Edited body text.", bodyFrom));

    expect(state.doc.firstChild?.attrs.open).toBe(false);
    expect(state.doc.firstChild?.firstChild?.textContent).toBe("More info");
    expect(state.doc.firstChild?.lastChild?.textContent).toBe("Edited body text.");
    expect(serializeMarkdown(state.doc)).toBe(`<details>
<summary>More info</summary>

Edited body text.

</details>`);
    expectStableRoundTrip(state);
  });

  it("offers an accessible closed-details action and restores focus", async () => {
    let state = createGFMarkdownState({ context, value: "" });
    const focus = vi.fn();
    const view = editorView(
      () => state,
      (transaction) => {
        state = state.apply(transaction);
      },
      focus,
    );

    render(<GFMarkdownToolbar state={state} view={view} />);
    const trigger = screen.getByRole("button", { name: "Insert details" });
    expect(trigger.getAttribute("aria-disabled")).not.toBe("true");

    await act(async () => fireEvent.click(trigger));

    expect(state.doc.firstChild?.attrs.open).toBe(false);
    expect(focus).toHaveBeenCalled();
  });

  it("disables insertion in an inline-only details summary", () => {
    let state = createGFMarkdownState({
      context,
      value: `<details>
<summary>Existing summary</summary>

Body

</details>`,
    });
    state = withSelection(state, findTextPosition(state, "Existing summary"));
    const view = editorView(
      () => state,
      (transaction) => {
        state = state.apply(transaction);
      },
      vi.fn(),
    );

    expect(insertDetails(state, undefined, view)).toBe(false);
    render(<GFMarkdownToolbar state={state} view={view} />);
    expect(
      screen.getByRole("button", { name: "Insert details" }).getAttribute(
        "aria-disabled",
      ),
    ).toBe("true");
  });

  it("disables insertion in table cells instead of splitting the table", () => {
    let state = createGFMarkdownState({
      context,
      value: `| Cell | Other |
| ---- | ----- |
| One  | Two   |`,
    });
    state = withSelection(state, findTextPosition(state, "One"));
    const original = state.doc.toJSON();

    expect(insertDetails(state)).toBe(false);
    expect(state.doc.toJSON()).toEqual(original);
  });

  it("disables insertion in definition terms instead of splitting the list", () => {
    let state = createGFMarkdownState({
      context,
      value: `<dl>
<dt>Existing term</dt>
<dd>Definition</dd>
</dl>`,
    });
    state = withSelection(state, findTextPosition(state, "Existing term"));
    const original = state.doc.toJSON();

    expect(insertDetails(state)).toBe(false);
    expect(state.doc.toJSON()).toEqual(original);
  });

  it.each([
    {
      label: "details summary",
      value: `<details>
<summary>Selected summary</summary>

Body

</details>`,
      nodeType: "details_summary",
    },
    {
      label: "definition term",
      value: `<dl>
<dt>Selected term</dt>
<dd>Definition</dd>
</dl>`,
      nodeType: "definition_term",
    },
  ])("disables insertion for a selected $label node", ({ value, nodeType }) => {
    let state = createGFMarkdownState({ context, value });
    let nodePos = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === nodeType) {
        nodePos = pos;
        return false;
      }
      return true;
    });
    state = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, nodePos)),
    );

    expect(insertDetails(state)).toBe(false);
  });

  it("does not move content across list ownership boundaries", () => {
    let state = createGFMarkdownState({
      context,
      value: `- First
- Second

Outside`,
    });
    state = withSelection(
      state,
      findTextPosition(state, "Second"),
      findTextPosition(state, "Outside") + "Outside".length,
    );
    state = runCommand(state, insertDetails);

    const list = state.doc.firstChild;
    expect(list?.type.name).toBe("bullet_list");
    expect(list?.child(1).textContent).toContain("Second");
    expect(findDescendant(state, "details")).toBeDefined();
    expect(state.doc.lastChild?.type.name).toBe("paragraph");
    expect(state.doc.lastChild?.textContent).toBe("Outside");
    expect(
      state.doc.textBetween(0, state.doc.content.size, "\n").match(/Outside/g),
    ).toHaveLength(1);
    expectStableRoundTrip(state);
  });

  it("does not move content across blockquote ownership boundaries", () => {
    let state = createGFMarkdownState({
      context,
      value: `> Quoted

Outside`,
    });
    state = withSelection(
      state,
      findTextPosition(state, "Quoted"),
      findTextPosition(state, "Outside") + "Outside".length,
    );
    state = runCommand(state, insertDetails);

    expect(state.doc.firstChild?.type.name).toBe("blockquote");
    expect(state.doc.firstChild?.textContent).toContain("Quoted");
    expect(findDescendant(state, "details")).toBeDefined();
    expect(state.doc.lastChild?.type.name).toBe("paragraph");
    expect(state.doc.lastChild?.textContent).toBe("Outside");
    expectStableRoundTrip(state);
  });

  it("undoes and redoes insertion with its exact selection", () => {
    let state = createGFMarkdownState({ context, value: "Selected body" });
    state = withSelection(
      state,
      findTextPosition(state, "Selected body"),
      findTextPosition(state, "Selected body") + "Selected body".length,
    );
    const before = state.doc.toJSON();
    state = runCommand(state, insertDetails);
    const inserted = state.doc.toJSON();
    const insertedSelection = state.selection.toJSON();

    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(before);

    expect(
      redo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(inserted);
    expect(state.selection.toJSON()).toEqual(insertedSelection);
  });

  it("replaces inserted details from controlled values", async () => {
    let emitted = "";
    const onChange = vi.fn((value: string) => {
      emitted = value;
    });
    const rendered = render(
      <GFMarkdownEditor context={context} onChange={onChange} value="" />,
    );

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Insert details" })),
    );
    await waitFor(() => expect(emitted).toContain("<details>"));

    rendered.rerender(
      <GFMarkdownEditor context={context} onChange={onChange} value={emitted} />,
    );
    expect(document.querySelector("details > p")).toBeTruthy();

    rendered.rerender(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value={`<details open>
<summary>Replacement</summary>

New body

</details>`}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Replacement")).toBeTruthy();
      expect(document.querySelector("details")?.open).toBe(true);
    });
  });

  it("round-trips inserted details through Markdown and HTML clipboard data", () => {
    let sourceState = createGFMarkdownState({
      context,
      value: "**Formatted body**",
    });
    sourceState = withSelection(
      sourceState,
      findTextPosition(sourceState, "Formatted body"),
      findTextPosition(sourceState, "Formatted body") + "Formatted body".length,
    );
    sourceState = runCommand(sourceState, insertDetails);
    sourceState = sourceState.apply(
      sourceState.tr.setSelection(NodeSelection.create(sourceState.doc, 0)),
    );

    const markdown = serializeMarkdownClipboardSlice(
      sourceState.selection.content(),
      sourceState.selection,
    );
    const markdownSlice = parseMarkdownClipboardText(markdown);
    expect(serializeMarkdownClipboardSlice(markdownSlice)).toBe(markdown);

    const sourceView = createEditorView(sourceState);
    const copied = sourceView.serializeForClipboard(
      sourceState.selection.content(),
    );
    const targetView = createEditorView(
      createGFMarkdownState({ context, value: "" }),
    );
    expect(targetView.pasteHTML(copied.dom.innerHTML, pasteEvent())).toBe(true);
    expect(targetView.state.doc.toJSON()).toEqual(
      parseMarkdown(markdown).toJSON(),
    );
    expectStableRoundTrip(targetView.state);

    sourceView.destroy();
    targetView.destroy();
  });

  it("preserves implicit summaries through HTML clipboard data", () => {
    const markdown = `<details>

Implicit body

</details>`;
    let sourceState = createGFMarkdownState({ context, value: markdown });
    sourceState = sourceState.apply(
      sourceState.tr.setSelection(NodeSelection.create(sourceState.doc, 0)),
    );
    const sourceView = createEditorView(sourceState);
    const copied = sourceView.serializeForClipboard(
      sourceState.selection.content(),
    );
    const targetView = createEditorView(
      createGFMarkdownState({ context, value: "" }),
    );

    expect(targetView.pasteHTML(copied.dom.innerHTML, pasteEvent())).toBe(true);
    expect(targetView.state.doc.firstChild?.attrs.implicitSummary).toBe(true);
    expect(serializeMarkdown(targetView.state.doc)).toBe(markdown);

    sourceView.destroy();
    targetView.destroy();
  });

  it("pastes standalone details safely into lists and rejects table insertion", () => {
    const markdown = `<details open>
<summary>Pasted details</summary>

Pasted body

</details>`;
    let listState = createGFMarkdownState({ context, value: "- Item" });
    listState = withSelection(
      listState,
      findTextPosition(listState, "Item") + "Item".length,
    );
    const listView = createEditorView(listState);
    expect(listView.pasteText(markdown, pasteEvent())).toBe(true);
    expect(listView.state.doc.firstChild?.attrs.tight).toBe(true);
    expect(listView.state.doc.firstChild?.firstChild?.attrs.spread).toBe(true);
    expectStableRoundTrip(listView.state);

    let nestedListState = createGFMarkdownState({
      context,
      value: `- One
- Two
  - Nested
- Three`,
    });
    nestedListState = withSelection(
      nestedListState,
      findTextPosition(nestedListState, "Two"),
      findTextPosition(nestedListState, "Two") + "Two".length,
    );
    const nestedListView = createEditorView(nestedListState);

    expect(nestedListView.pasteText(markdown, pasteEvent())).toBe(true);
    expect(nestedListView.state.doc.firstChild?.child(1).firstChild?.textContent).toBe(
      "Two",
    );
    expectStableRoundTrip(nestedListView.state);

    let emptyItemState = createGFMarkdownState({
      context,
      value: `- One
- `,
    });
    emptyItemState = withSelection(
      emptyItemState,
      findEmptyParagraphPosition(emptyItemState),
    );
    const emptyItemView = createEditorView(emptyItemState);

    expect(emptyItemView.pasteText(markdown, pasteEvent())).toBe(true);
    expect(emptyItemView.state.doc.firstChild?.type.name).toBe("bullet_list");
    expect(emptyItemView.state.doc.lastChild?.type.name).toBe("details");
    expectStableRoundTrip(emptyItemView.state);

    let tableState = createGFMarkdownState({
      context,
      value: `| Cell | Other |
| ---- | ----- |
| One  | Two   |`,
    });
    tableState = withSelection(tableState, findTextPosition(tableState, "One"));
    const original = tableState.doc.toJSON();
    const tableView = createEditorView(tableState);

    expect(tableView.pasteText(markdown, pasteEvent())).toBe(true);
    expect(tableView.state.doc.toJSON()).toEqual(original);

    let summaryState = createGFMarkdownState({
      context,
      value: `<details>
<summary>Existing summary</summary>

Existing body

</details>`,
    });
    summaryState = withSelection(
      summaryState,
      findTextPosition(summaryState, "Existing summary") + "Existing ".length,
    );
    const summaryOriginal = summaryState.doc.toJSON();
    const summaryView = createEditorView(summaryState);

    expect(summaryView.pasteText(markdown, pasteEvent())).toBe(true);
    expect(summaryView.state.doc.toJSON()).toEqual(summaryOriginal);

    let footnoteState = createGFMarkdownState({
      context,
      value: `Text

[^a]: Foot one

    Foot two`,
    });
    footnoteState = withSelection(
      footnoteState,
      findTextPosition(footnoteState, "Text"),
      findTextPosition(footnoteState, "Foot one") + "Foot one".length,
    );
    const footnoteView = createEditorView(footnoteState);

    expect(footnoteView.pasteText(markdown, pasteEvent())).toBe(true);
    expect(footnoteView.state.doc.textContent).toContain("Text");
    expect(footnoteView.state.doc.textContent).toContain("Foot one");
    expect(footnoteView.state.doc.textContent).toContain("Foot two");
    expectStableRoundTrip(footnoteView.state);

    listView.destroy();
    nestedListView.destroy();
    emptyItemView.destroy();
    tableView.destroy();
    summaryView.destroy();
    footnoteView.destroy();
  });

  it("hides insertion UI with the toolbar while details rendering remains", () => {
    render(
      <GFMarkdownEditor
        context={context}
        toolbar={false}
        value={`<details>
<summary>Still editable</summary>

Body

</details>`}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Insert details" }),
    ).toBeNull();
    expect(screen.getByText("Still editable").tagName).toBe("SUMMARY");
    expect(screen.getByText("Body")).toBeTruthy();
  });
});

function expectStableRoundTrip(state: EditorState) {
  state.doc.check();
  const markdown = serializeMarkdown(state.doc);
  const reparsed = parseMarkdown(markdown);
  expect(reparsed.toJSON()).toEqual(state.doc.toJSON());
  expect(serializeMarkdown(reparsed)).toBe(markdown);
}

function findDescendant(state: EditorState, type: string) {
  let found: EditorState["doc"] | undefined;
  state.doc.descendants((node) => {
    if (node.type.name === type) {
      found = node;
      return false;
    }
    return true;
  });
  return found;
}

function findEmptyParagraphPosition(state: EditorState) {
  let position = -1;
  state.doc.descendants((node, pos) => {
    if (node.type.name === "paragraph" && node.content.size === 0) {
      position = pos + 1;
    }
  });
  expect(position).toBeGreaterThanOrEqual(0);
  return position;
}

function editorView(
  getState: () => EditorState,
  dispatch: (transaction: Transaction) => void,
  focus: () => void,
) {
  return {
    get state() {
      return getState();
    },
    dispatch,
    focus,
  } as unknown as EditorView;
}
