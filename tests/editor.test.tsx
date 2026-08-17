import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { closeHistory, redo, undo } from "prosemirror-history";
import { DOMSerializer } from "prosemirror-model";
import {
  NodeSelection,
  TextSelection,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { describe, expect, it, vi } from "vitest";
import {
  createGFMarkdownState,
  GFMarkdownEditor,
  gfmSchema,
  parseHTML,
  serializeMarkdown,
} from "../src";
import {
  applyLinkEdit,
  linkSelection,
  openLink,
  removeLink,
} from "../src/link";
import { autolinkRanges } from "../src/autolink";
import {
  changeListIndent,
  changeListType,
  currentListKind,
} from "../src/lists/commands";
import {
  parseMarkdownClipboardText,
  serializeMarkdownClipboardSlice,
} from "../src/clipboard";

const context = { owner: "cschleiden", repo: "react-gfmd" };

describe("GFMarkdownEditor", () => {
  it("renders the formatting toolbar by default", () => {
    render(<GFMarkdownEditor context={context} value="Hello" />);

    expect(screen.getByLabelText("Markdown formatting")).toBeTruthy();
    expect(screen.getByTitle("Bold")).toBeTruthy();
    expect(screen.getByTitle("Code block")).toBeTruthy();
  });

  it("can hide the formatting toolbar", () => {
    render(
      <GFMarkdownEditor context={context} toolbar={false} value="Hello" />,
    );

    expect(screen.queryByLabelText("Markdown formatting")).toBeNull();
  });

  it("renders task list checkboxes", () => {
    render(
      <GFMarkdownEditor
        context={context}
        value={"- [ ] Open task\n- [x] Done task"}
      />,
    );

    const openTask = screen.getByRole("checkbox", {
      name: "Mark task complete",
    });
    const doneTask = screen.getByRole("checkbox", {
      name: "Mark task incomplete",
    });

    expect((openTask as HTMLInputElement).checked).toBe(false);
    expect((doneTask as HTMLInputElement).checked).toBe(true);
  });

  it("renders details blocks as editable structured content", () => {
    render(
      <GFMarkdownEditor
        context={context}
        value={`<details open>
<summary>More info</summary>

Body

</details>`}
      />,
    );

    const details = document.querySelector("details");
    expect(details?.open).toBe(true);
    expect(screen.getByText("More info").tagName).toBe("SUMMARY");
    expect(screen.getByText("Body")).toBeTruthy();
  });

  it("renders details blocks without explicit summaries", () => {
    render(
      <GFMarkdownEditor
        context={context}
        value={`<details>

# Hello

</details>`}
      />,
    );

    expect(document.querySelector("details")).toBeTruthy();
    expect(screen.getByText("Details").tagName).toBe("SUMMARY");
    expect(screen.getByRole("heading", { name: "Hello" })).toBeTruthy();
  });

  it("renders Markdown inside balanced unsupported block HTML", () => {
    const markdown = `<div align="center">

**Markdown inside raw HTML should not disappear.**

</div>`;
    render(<GFMarkdownEditor context={context} value={markdown} />);

    expect(
      screen.getByText("Markdown inside raw HTML should not disappear.")
        .tagName,
    ).toBe("STRONG");
    expect(document.querySelectorAll("[data-gfmd-raw-block]")).toHaveLength(2);
    expect(
      serializeMarkdown(createGFMarkdownState({ context, value: markdown }).doc),
    ).toBe(markdown);
  });

  it("selects, copies, pastes, deletes, and restores a raw HTML region atomically", () => {
    const markdown = "<div><span>opaque</span></div>";
    let state = createGFMarkdownState({ context, value: markdown });
    const raw = state.doc.firstChild!;

    expect(raw.type.name).toBe("raw_block");
    state = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, 0)),
    );
    expect(state.selection).toBeInstanceOf(NodeSelection);
    expect((state.selection as NodeSelection).node.eq(raw)).toBe(true);
    expect(serializeMarkdownClipboardSlice(state.selection.content())).toBe(markdown);

    const pasted = parseMarkdownClipboardText(markdown);
    expect(pasted.content.childCount).toBe(1);
    expect(pasted.content.firstChild?.toJSON()).toEqual(raw.toJSON());

    state = state.apply(closeHistory(state.tr.deleteSelection()));
    expect(serializeMarkdown(state.doc)).toBe("");
    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(serializeMarkdown(state.doc)).toBe(markdown);
    expect(
      redo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(serializeMarkdown(state.doc)).toBe("");
  });

  it("preserves raw region metadata through the HTML clipboard DOM path", () => {
    const markdown = "<div><span>opaque</span></div>";
    const raw = createGFMarkdownState({ context, value: markdown }).doc.firstChild!;
    const container = document.createElement("div");
    container.appendChild(
      DOMSerializer.fromSchema(gfmSchema).serializeNode(raw),
    );

    const reparsed = parseHTML(container.innerHTML).firstChild;
    expect(reparsed?.toJSON()).toEqual(raw.toJSON());
    expect(reparsed?.attrs).toMatchObject({
      kind: "html_region",
      tagName: "div",
      malformed: false,
    });
  });

  it("replaces an atomic raw HTML region on controlled value updates", () => {
    const first = "<div><span>First</span></div>";
    const second = "<section><span>Second</span></section>";
    const rendered = render(
      <GFMarkdownEditor context={context} value={first} />,
    );

    expect(
      screen.getByLabelText("Preserved unsupported HTML <div> region"),
    ).toBeTruthy();
    rendered.rerender(<GFMarkdownEditor context={context} value={second} />);

    expect(
      screen.queryByLabelText("Preserved unsupported HTML <div> region"),
    ).toBeNull();
    expect(
      screen.getByLabelText("Preserved unsupported HTML <section> region")
        .textContent,
    ).toBe(second);
  });

  it("toggles unchecked task list checkboxes", async () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value="- [ ] Task item"
      />,
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mark task complete" }),
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(
        "- [x] Task item",
        expect.anything(),
      );
    });
  });

  it("toggles checked task list checkboxes", async () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value="- [x] Task item"
      />,
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mark task incomplete" }),
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(
        "- [ ] Task item",
        expect.anything(),
      );
    });
  });

  it("inserts task lists from the toolbar", () => {
    const onChange = vi.fn();
    render(<GFMarkdownEditor context={context} onChange={onChange} value="" />);

    fireEvent.click(screen.getByTitle("Task list"));

    expect(
      screen.getByRole("checkbox", { name: "Mark task complete" }),
    ).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith(
      "- [ ] Task item",
      expect.anything(),
    );
  });

  it("converts the current paragraph into a task list item", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value="Task item"
      />,
    );

    fireEvent.click(screen.getByTitle("Task list"));

    expect(
      screen.getByRole("checkbox", { name: "Mark task complete" }),
    ).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith(
      "- [ ] Task item",
      expect.anything(),
    );
  });

  it("converts the current list item into a task list item", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value="- Plain item"
      />,
    );

    fireEvent.click(screen.getByTitle("Task list"));

    expect(
      screen.getByRole("checkbox", { name: "Mark task complete" }),
    ).toBeTruthy();
    expect(onChange).toHaveBeenLastCalledWith(
      "- [ ] Plain item",
      expect.anything(),
    );
  });

  it("changes only the current list item type from the toolbar", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value="- first\n- second"
      />,
    );

    const editor = document.querySelector(".gfmd-editor-surface") as HTMLElement;
    expect(editor).toBeTruthy();
    editor.focus();

    const numberedListButton = screen.getByTitle("Numbered list");
    fireEvent.mouseDown(numberedListButton);
    fireEvent.click(numberedListButton);

    expect(onChange).toHaveBeenLastCalledWith(
      "1. first\\n- second",
      expect.anything(),
    );
  });

  it("can undo list type changes", () => {
    let state = createGFMarkdownState({
      context,
      value: "- first\n- second",
    });

    expect(
      changeListType("ordered")(
        state,
        (tr) => {
          state = state.apply(tr);
        },
        undefined,
      ),
    ).toBe(true);
    expect(serializeMarkdown(state.doc)).toBe(`1. first

- second`);

    expect(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(serializeMarkdown(state.doc)).toBe("- first\n- second");
  });

  it("changes only selected list items", () => {
    let state = createGFMarkdownState({
      context,
      value: "- first\n- second\n- third",
    });
    const secondPos = findTextPosition(state, "second");
    const thirdPos = findTextPosition(state, "third");
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, secondPos, thirdPos + 5)),
    );

    expect(
      changeListType("ordered")(
        state,
        (tr) => {
          state = state.apply(tr);
        },
        undefined,
      ),
    ).toBe(true);

    expect(serializeMarkdown(state.doc)).toBe(`- first

1. second
2. third`);
  });

  it("preserves task state and descendants during list container conversion", () => {
    let state = createGFMarkdownState({
      context,
      value: `- anchor
- [x] selected

  3. descendant

- [ ] selected two
- tail`,
    });
    const originalDoc = state.doc.toJSON();
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(
          state.doc,
          findTextPosition(state, "selected"),
          findTextPosition(state, "selected two") + 12,
        ),
      ),
    );
    const selectedText = state.doc.textBetween(
      state.selection.from,
      state.selection.to,
      " ",
    );

    expect(
      changeListType("ordered")(
        state,
        (transaction) => {
          state = state.apply(transaction);
        },
        undefined,
      ),
    ).toBe(true);

    expect(state.doc.childCount).toBe(3);
    const converted = state.doc.child(1);
    expect(converted.type.name).toBe("ordered_list");
    expect(converted.childCount).toBe(2);
    expect(converted.child(0).type.name).toBe("task_list_item");
    expect(converted.child(0).attrs.checked).toBe(true);
    expect(converted.child(0).lastChild?.type.name).toBe("ordered_list");
    expect(converted.child(0).lastChild?.attrs.order).toBe(3);
    expect(converted.child(1).type.name).toBe("task_list_item");
    expect(converted.child(1).attrs.checked).toBe(false);
    expect(
      state.doc.textBetween(state.selection.from, state.selection.to, " "),
    ).toBe(selectedText);
    expect(
      createGFMarkdownState({
        context,
        value: serializeMarkdown(state.doc),
      }).doc.toJSON(),
    ).toEqual(state.doc.toJSON());
    const convertedDoc = state.doc.toJSON();

    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(originalDoc);
    expect(
      redo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(convertedDoc);
  });

  it("continues ordered numbering after converting a middle selection", () => {
    let state = createGFMarkdownState({
      context,
      value: `4. first
5. second
6. third`,
    });
    const secondPos = findTextPosition(state, "second");
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, secondPos + 1)),
    );

    expect(
      changeListType("bullet")(
        state,
        (transaction) => {
          state = state.apply(transaction);
        },
        undefined,
      ),
    ).toBe(true);

    expect(state.doc.child(0).attrs.order).toBe(4);
    expect(state.doc.child(1).type.name).toBe("bullet_list");
    expect(state.doc.child(2).attrs.order).toBe(6);
    expect(serializeMarkdown(state.doc)).toBe(`4. first

- second

6. third`);
  });

  it("converts the enclosing list when a selection crosses nested levels", () => {
    let state = createGFMarkdownState({
      context,
      value: `- parent
  - nested
- [x] tail`,
    });
    const originalDoc = state.doc.toJSON();
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(
          state.doc,
          findTextPosition(state, "nested"),
          findTextPosition(state, "tail") + 4,
        ),
      ),
    );
    const selectedText = state.doc.textBetween(
      state.selection.from,
      state.selection.to,
      " ",
    );

    expect(
      changeListType("ordered")(
        state,
        (transaction) => {
          state = state.apply(transaction);
        },
        undefined,
      ),
    ).toBe(true);

    const list = state.doc.firstChild;
    expect(list?.type.name).toBe("ordered_list");
    expect(list?.childCount).toBe(2);
    expect(list?.firstChild?.lastChild?.type.name).toBe("bullet_list");
    expect(list?.child(1).type.name).toBe("task_list_item");
    expect(list?.child(1).attrs.checked).toBe(true);
    expect(
      state.doc.textBetween(state.selection.from, state.selection.to, " "),
    ).toBe(selectedText);
    expect(
      createGFMarkdownState({
        context,
        value: serializeMarkdown(state.doc),
      }).doc.toJSON(),
    ).toEqual(state.doc.toJSON());

    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(originalDoc);
  });

  it("converts selected tasks to plain items without losing descendants", () => {
    let state = createGFMarkdownState({
      context,
      value: `- [x] task

  3. descendant

- [ ] other`,
    });
    const taskPos = findTextPosition(state, "task");
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, taskPos + 1)),
    );

    expect(
      changeListType("bullet")(
        state,
        (transaction) => {
          state = state.apply(transaction);
        },
        undefined,
      ),
    ).toBe(true);

    const list = state.doc.firstChild;
    expect(list?.firstChild?.type.name).toBe("list_item");
    expect(list?.firstChild?.lastChild?.type.name).toBe("ordered_list");
    expect(list?.firstChild?.lastChild?.attrs.order).toBe(3);
    expect(list?.child(1).type.name).toBe("task_list_item");
    expect(list?.child(1).attrs.checked).toBe(false);
    expect(
      createGFMarkdownState({
        context,
        value: serializeMarkdown(state.doc),
      }).doc.toJSON(),
    ).toEqual(state.doc.toJSON());
  });

  it("changes the current task item into a plain list item", () => {
    let state = createGFMarkdownState({
      context,
      value: "- [ ] task\n- other",
    });
    const taskPos = findTextPosition(state, "task");
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, taskPos + 1)),
    );

    expect(
      changeListType("bullet")(
        state,
        (tr) => {
          state = state.apply(tr);
        },
        undefined,
      ),
    ).toBe(true);

    expect(serializeMarkdown(state.doc)).toBe("- task\n- other");
  });

  it("reports the list type for the current line", () => {
    let state = createGFMarkdownState({
      context,
      value: "- bullet\n1. ordered\n- [ ] task",
    });

    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, findTextPosition(state, "bullet") + 1),
      ),
    );
    expect(currentListKind(state)).toBe("bullet");

    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, findTextPosition(state, "ordered") + 1),
      ),
    );
    expect(currentListKind(state)).toBe("ordered");

    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, findTextPosition(state, "task") + 1),
      ),
    );
    expect(currentListKind(state)).toBe("task");
  });

  it("waits for the character after dash-space before starting a bullet list", () => {
    let state = createGFMarkdownState({ context, value: "" });

    state = typeText(state, "- ");
    expect(state.doc.firstChild?.type.name).toBe("paragraph");
    expect(state.doc.textContent).toBe("- ");

    state = typeText(state, "a");
    expect(state.doc.firstChild?.type.name).toBe("bullet_list");
    expect(serializeMarkdown(state.doc)).toBe("- a");
  });

  it("turns dash-space-checkbox into a task list", () => {
    const state = typeText(createGFMarkdownState({ context, value: "" }), "- [ ]");
    const listItem = state.doc.firstChild?.firstChild;

    expect(state.doc.firstChild?.type.name).toBe("bullet_list");
    expect(listItem?.type.name).toBe("task_list_item");
    expect(listItem?.attrs.checked).toBe(false);
  });

  it("converts hash-space into an empty heading immediately", () => {
    let state = createGFMarkdownState({ context, value: "" });

    state = typeText(state, "# ");
    expect(state.doc.firstChild?.type.name).toBe("heading");
    expect(state.doc.firstChild?.attrs.level).toBe(1);
    expect(state.doc.textContent).toBe("");

    state = typeText(state, "foo");
    expect(serializeMarkdown(state.doc)).toBe("# foo");
  });

  it("uses the typed hash count as the heading level", () => {
    const state = typeText(createGFMarkdownState({ context, value: "" }), "## foo");

    expect(state.doc.firstChild?.type.name).toBe("heading");
    expect(state.doc.firstChild?.attrs.level).toBe(2);
    expect(serializeMarkdown(state.doc)).toBe("## foo");
  });

  it("converts star and underscore emphasis shortcuts into marks", () => {
    const starState = typeText(createGFMarkdownState({ context, value: "" }), "*foo*");
    const underscoreState = typeText(
      createGFMarkdownState({ context, value: "" }),
      "_foo_",
    );

    expect(firstTextMarkNames(starState)).toEqual(["em"]);
    expect(firstTextMarkNames(underscoreState)).toEqual(["em"]);
    expect(serializeMarkdown(starState.doc)).toBe("*foo*");
    expect(serializeMarkdown(underscoreState.doc)).toBe("*foo*");
  });

  it("converts double star and underscore strong shortcuts into marks", () => {
    const starState = typeText(
      createGFMarkdownState({ context, value: "" }),
      "**foo**",
    );
    const underscoreState = typeText(
      createGFMarkdownState({ context, value: "" }),
      "__foo__",
    );

    expect(firstTextMarkNames(starState)).toEqual(["strong"]);
    expect(firstTextMarkNames(underscoreState)).toEqual(["strong"]);
    expect(serializeMarkdown(starState.doc)).toBe("**foo**");
    expect(serializeMarkdown(underscoreState.doc)).toBe("**foo**");
  });

  it("converts backtick code shortcuts into marks", () => {
    const state = typeText(createGFMarkdownState({ context, value: "" }), "`foo`");

    expect(firstTextMarkNames(state)).toEqual(["code"]);
    expect(serializeMarkdown(state.doc)).toBe("`foo`");
  });

  it("updates code block language from the language dropdown", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value={"```ts\nconst value = 1;\n```"}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Code language" }));
    fireEvent.click(screen.getByText("JavaScript"));

    expect(onChange).toHaveBeenLastCalledWith(
      "```javascript\nconst value = 1;\n```",
      expect.anything(),
    );
  });

  it("renders a clear formatting action in the toolbar", () => {
    render(<GFMarkdownEditor context={context} value="**bold** *italic*" />);

    expect(screen.getByTitle("Clear formatting")).toBeTruthy();
  });

  it("creates a link at the cursor from the accessible link editor", async () => {
    const onChange = vi.fn();
    render(<GFMarkdownEditor context={context} onChange={onChange} value="" />);

    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Link URL")),
    );
    fireEvent.change(screen.getByLabelText("Link text"), {
      target: { value: "Documentation" },
    });
    fireEvent.change(screen.getByLabelText("Link URL"), {
      target: { value: "../docs/start.md#intro" },
    });
    fireEvent.change(screen.getByLabelText("Link title"), {
      target: { value: "Read the docs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onChange).toHaveBeenLastCalledWith(
      '[Documentation](../docs/start.md#intro "Read the docs")',
      expect.anything(),
    );
  });

  it("edits the active link URL, title, and label", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value="[Old](https://old.example)"
      />,
    );

    const editButton = screen.getByRole("button", { name: "Edit link" });
    expect(editButton.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(editButton);
    fireEvent.change(screen.getByLabelText("Link text"), {
      target: { value: "New" },
    });
    fireEvent.change(screen.getByLabelText("Link URL"), {
      target: { value: "#new" },
    });
    fireEvent.change(screen.getByLabelText("Link title"), {
      target: { value: "New title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onChange).toHaveBeenLastCalledWith(
      '[New](#new "New title")',
      expect.anything(),
    );
  });

  it("cancels link edits without changing the document", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value="[Keep](#keep)"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
    fireEvent.change(screen.getByLabelText("Link URL"), {
      target: { value: "#changed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Link URL")).toBeNull();
  });

  it("unlinks while preserving the label", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value="[*Keep formatting*](#keep)"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));

    expect(onChange).toHaveBeenLastCalledWith("*Keep formatting*", expect.anything());
  });

  it("does not navigate from editable links and uses an explicit open action", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <GFMarkdownEditor
        context={context}
        value="[Open](../relative/path#section)"
      />,
    );

    fireEvent.click(screen.getByText("Open"));
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
    fireEvent.click(screen.getByRole("button", { name: "Open link" }));
    expect(open).toHaveBeenCalledWith(
      "../relative/path#section",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  it("blocks unsafe schemes only when opening a link", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(
      <GFMarkdownEditor
        context={context}
        value="[Unsafe](javascript:alert(1))"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
    expect((screen.getByLabelText("Link URL") as HTMLInputElement).value).toBe(
      "javascript:alert(1)",
    );
    fireEvent.click(screen.getByRole("button", { name: "Open link" }));

    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("cannot be opened");
    open.mockRestore();
  });

  it("closes a pending link editor on a controlled value update", () => {
    const { rerender } = render(
      <GFMarkdownEditor context={context} value="[Old](#old)" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
    expect(screen.getByLabelText("Link URL")).toBeTruthy();

    rerender(<GFMarkdownEditor context={context} value="Replacement" />);

    expect(screen.queryByLabelText("Link URL")).toBeNull();
    expect(screen.getByText("Replacement")).toBeTruthy();
  });

  it("preserves link marks when parsing clipboard HTML", () => {
    const doc = parseHTML(
      '<p><a href="../docs" title="Docs"><strong>Documentation</strong></a></p>',
    );

    expect(serializeMarkdown(doc)).toBe(
      '[**Documentation**](../docs "Docs")',
    );
  });

  it("preserves empty links and titles through editor HTML", () => {
    render(
      <GFMarkdownEditor
        context={context}
        value={'[](https://example.com "Some title")'}
      />,
    );
    const rendered = screen.getByRole("link", {
      name: "Empty link to https://example.com",
    });
    const reparsed = parseHTML(`<p>${rendered.outerHTML}</p>`);

    expect(serializeMarkdown(reparsed)).toBe(
      '[](https://example.com "Some title")',
    );
    expect(reparsed.firstChild?.firstChild?.type.name).toBe("empty_link");
  });

  it("creates, edits, and unlinks links without losing overlapping marks", () => {
    let state = createGFMarkdownState({ context, value: "**Bold label**" });
    const from = findTextPosition(state, "Bold label");
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, from, from + "Bold label".length),
      ),
    );
    const createSelection = linkSelection(state)!;
    state = state.apply(
      applyLinkEdit(state, createSelection, {
        href: "mailto:user@example.com",
        label: "Bold label",
        title: "",
      }),
    );
    expect(serializeMarkdown(state.doc)).toBe(
      "[**Bold label**](mailto:user@example.com)",
    );

    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, from + 2)),
    );
    expect(linkIsActive(state)).toBe(true);
    const editSelection = linkSelection(state)!;
    state = state.apply(
      applyLinkEdit(state, editSelection, {
        href: "#anchor",
        label: "Bold link",
        title: "Anchor",
      }),
    );
    expect(serializeMarkdown(state.doc)).toBe(
      '[**Bold link**](#anchor "Anchor")',
    );

    const unlinkSelection = linkSelection(state)!;
    state = state.apply(removeLink(state, unlinkSelection));
    expect(serializeMarkdown(state.doc)).toBe("**Bold link**");
  });

  it("creates and edits an empty-label link without dropping it", () => {
    let state = createGFMarkdownState({ context, value: "" });
    const createSelection = linkSelection(state)!;
    state = state.apply(
      applyLinkEdit(state, createSelection, {
        href: "../empty",
        label: "",
        title: "Empty",
      }),
    );

    expect(state.selection).toBeInstanceOf(NodeSelection);
    expect(serializeMarkdown(state.doc)).toBe('[](../empty "Empty")');

    state = state.apply(
      applyLinkEdit(state, linkSelection(state)!, {
        href: "#filled",
        label: "Now visible",
        title: "",
      }),
    );
    expect(serializeMarkdown(state.doc)).toBe("[Now visible](#filled)");
  });

  it("turns an existing link into an empty-label link without data loss", () => {
    let state = createGFMarkdownState({ context, value: "[Old](#old)" });
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2)),
    );
    state = state.apply(
      applyLinkEdit(state, linkSelection(state)!, {
        href: "#empty",
        label: "",
        title: "Still linked",
      }),
    );

    expect(state.selection).toBeInstanceOf(NodeSelection);
    expect(serializeMarkdown(state.doc)).toBe('[](#empty "Still linked")');
  });

  it("disables link editing for non-text node selections", () => {
    const state = createGFMarkdownState({
      context,
      value: "![Image](image.png)",
    });
    const imagePosition = 1;
    const selected = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, imagePosition)),
    );

    expect(linkSelection(selected)).toBeNull();
  });

  it("edits a linked image without replacing its content", () => {
    let state = createGFMarkdownState({
      context,
      value: "[![Build](badge.svg)](https://ci.example)",
    });

    const imagePosition = findNodePosition(state, "image");
    state = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, imagePosition)),
    );
    const target = linkSelection(state);

    expect(target?.kind).toBe("existing");
    expect(target?.label).toBeNull();
    state = state.apply(
      applyLinkEdit(state, target!, {
        href: "https://ci.example/new",
        label: null,
        title: "Build status",
      }),
    );

    expect(state.doc.nodeAt(imagePosition)?.type.name).toBe("image");
    expect(serializeMarkdown(state.doc)).toBe(
      '[![Build](badge.svg)](https://ci.example/new "Build status")',
    );
  });

  it("restores the selected inline node inside a mixed-content link", () => {
    let state = createGFMarkdownState({
      context,
      value: "[text ![Build](badge.svg)](https://ci.example)",
    });
    const imagePosition = findNodePosition(state, "image");
    state = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, imagePosition)),
    );
    const target = linkSelection(state)!;
    state = state.apply(
      applyLinkEdit(state, target, {
        href: "https://ci.example/new",
        label: null,
        title: "",
      }),
    );

    expect(state.selection).toBeInstanceOf(NodeSelection);
    expect(state.selection.from).toBe(imagePosition);
    expect((state.selection as NodeSelection).node.type.name).toBe("image");
    expect(serializeMarkdown(state.doc)).toBe(
      "[text ![Build](badge.svg)](https://ci.example/new)",
    );
  });

  it("edits links containing hard breaks without position assumptions", () => {
    let state = createGFMarkdownState({
      context,
      value: `[a\\
b](#old)`,
    });
    const aPosition = findTextPosition(state, "a");
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, aPosition + 1)),
    );
    const target = linkSelection(state);
    expect(target?.label).toBeNull();
    state = state.apply(
      applyLinkEdit(state, target!, {
        href: "#new",
        label: null,
        title: "",
      }),
    );

    const paragraph = state.doc.firstChild!;
    expect(paragraph.childCount).toBe(3);
    expect(paragraph.child(0).text).toBe("a");
    expect(paragraph.child(1).type.name).toBe("hard_break");
    expect(paragraph.child(2).text).toBe("b");
    for (let index = 0; index < paragraph.childCount; index += 1) {
      expect(
        gfmSchema.marks.link.isInSet(paragraph.child(index).marks)?.attrs.href,
      ).toBe("#new");
    }
    expect(serializeMarkdown(state.doc)).toContain("(#new)");
  });

  it.each([
    {
      markdown: "see [**Old**](#old)",
      expected: "see [**New**](#new)",
    },
    {
      markdown: "**see**[Old](#old)",
      expected: "**see**[New](#new)",
    },
  ])(
    "relabels without leaking or dropping adjacent marks: $markdown",
    ({ markdown, expected }) => {
      let state = createGFMarkdownState({ context, value: markdown });
      const oldPosition = findTextPosition(state, "Old");
      state = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, oldPosition + 1)),
      );

      state = state.apply(
        applyLinkEdit(state, linkSelection(state)!, {
          href: "#new",
          label: "New",
          title: "",
        }),
      );

      expect(serializeMarkdown(state.doc)).toBe(expected);
    },
  );

  it("inherits link formatting when text is appended to the label", () => {
    let state = createGFMarkdownState({
      context,
      value: "[**Old**](#old)",
    });
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2)),
    );
    state = state.apply(
      applyLinkEdit(state, linkSelection(state)!, {
        href: "#new",
        label: "Oldest",
        title: "",
      }),
    );

    expect(serializeMarkdown(state.doc)).toBe("[**Oldest**](#new)");
  });

  it("exposes opaque linked content as preserved, non-editable content", () => {
    render(
      <GFMarkdownEditor
        context={context}
        value="[![Build](badge.svg)](https://ci.example)"
      />,
    );
    const image = screen.getByRole("img", { name: "Build" });
    fireEvent.click(image);
    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));

    const label = screen.getByLabelText("Link text") as HTMLInputElement;
    expect(label.disabled).toBe(true);
    expect(label.value).toBe("Non-text link content");
  });

  it("does not expose editable link destinations as native navigation targets", () => {
    render(
      <GFMarkdownEditor
        context={context}
        value="[Unsafe](javascript:alert(1))"
      />,
    );

    const linkText = screen.getByText("Unsafe");
    expect(linkText.tagName).toBe("A");
    expect(linkText.getAttribute("href")).toBeNull();
    expect(linkText.getAttribute("data-href")).toBe("javascript:alert(1)");
  });

  it("renders safe destinations as native links for accessibility and copying", () => {
    render(<GFMarkdownEditor context={context} value="[Docs](../docs)" />);

    const link = screen.getByRole("link", { name: "Docs" });
    expect(link.getAttribute("href")).toBe("../docs");
    expect(link.getAttribute("data-href")).toBe("../docs");
  });

  it("keeps surrounding nested-list and table structure during link edits", () => {
    let state = createGFMarkdownState({
      context,
      value: `- parent
  - [nested](#old)

| Link |
| ---- |
| [cell](../old) |`,
    });
    const before = state.doc.toJSON();
    const nestedPos = findTextPosition(state, "nested");
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, nestedPos + 2)),
    );
    state = state.apply(
      applyLinkEdit(state, linkSelection(state)!, {
        href: "#new",
        label: "nested",
        title: "",
      }),
    );

    expect(state.doc.firstChild?.firstChild?.lastChild?.type.name).toBe(
      "bullet_list",
    );
    expect(state.doc.child(1).type.name).toBe("table");
    expect(state.doc.child(1).toJSON()).toEqual(before.content[1]);
    expect(serializeMarkdown(state.doc)).toContain("[nested](#new)");
    expect(
      createGFMarkdownState({
        context,
        value: serializeMarkdown(state.doc),
      }).doc.toJSON(),
    ).toEqual(state.doc.toJSON());
  });

  it("supports undo and redo for a link edit", () => {
    let state = createGFMarkdownState({ context, value: "[Old](#old)" });
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 2)),
    );
    state = state.apply(
      applyLinkEdit(state, linkSelection(state)!, {
        href: "#new",
        label: "New",
        title: "",
      }),
    );
    expect(serializeMarkdown(state.doc)).toBe("[New](#new)");

    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(serializeMarkdown(state.doc)).toBe("[Old](#old)");
    expect(
      redo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(serializeMarkdown(state.doc)).toBe("[New](#new)");
  });

  it("allows relative, anchor, mailto, and unusual destinations to open safely", () => {
    const opener = vi.fn(() => null);
    for (const href of [
      "../docs/read me.md",
      "#heading",
      "mailto:user@example.com",
      "github-windows://openRepo/example",
    ]) {
      expect(openLink(href, opener)).toBe(true);
    }
    expect(opener).toHaveBeenCalledTimes(4);
  });

  it.each([
    {
      typed: "https://example.com ",
      markdown: "<https://example.com>&#x20;",
      href: "https://example.com",
    },
    {
      typed: "www.example.com ",
      markdown: "[www.example.com](http://www.example.com)&#x20;",
      href: "http://www.example.com",
    },
    {
      typed: "user@example.com ",
      markdown: "<user@example.com>&#x20;",
      href: "mailto:user@example.com",
    },
  ])("auto-links typed GFM text: $typed", ({ typed, markdown, href }) => {
    const state = typeText(createGFMarkdownState({ context, value: "" }), typed);
    const firstText = state.doc.firstChild?.firstChild;

    expect(serializeMarkdown(state.doc)).toBe(markdown);
    expect(firstText?.marks[0]?.attrs.href).toBe(href);
  });

  it("auto-links before trailing punctuation without linking the punctuation", () => {
    const state = typeText(
      createGFMarkdownState({ context, value: "" }),
      "See https://example.com, ",
    );
    const paragraph = state.doc.firstChild;

    expect(serializeMarkdown(state.doc)).toBe(
      "See <https://example.com>,&#x20;",
    );
    expect(paragraph?.lastChild?.text).toBe(", ");
    expect(paragraph?.lastChild?.marks).toHaveLength(0);
  });

  it("auto-links the current token before Enter", () => {
    let state = typeText(
      createGFMarkdownState({ context, value: "" }),
      "https://example.com",
    );
    state = runKey(state, "Enter");

    expect(serializeMarkdown(state.doc)).toBe("<https://example.com>");
    expect(state.doc.childCount).toBe(2);
  });

  it("auto-links the current token before a hard break", () => {
    let state = typeText(
      createGFMarkdownState({ context, value: "" }),
      "https://example.com",
    );
    state = state.apply(
      state.tr.replaceSelectionWith(gfmSchema.nodes.hard_break.create()),
    );

    expect(linkIsActive(
      state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 2)),
      ),
    )).toBe(true);
    expect(state.doc.firstChild?.lastChild?.type.name).toBe("hard_break");
  });

  it("auto-links every GFM URL and email in pasted plain text", () => {
    let state = createGFMarkdownState({ context, value: "" });
    state = state.apply(
      state.tr
        .insertText("Visit https://example.com or email user@example.com")
        .setMeta("uiEvent", "paste"),
    );

    expect(serializeMarkdown(state.doc)).toBe(
      "Visit <https://example.com> or email <user@example.com>",
    );
  });

  it("does not auto-link relative paths, anchors, or inline code", () => {
    expect(autolinkRanges("../docs/file.md #heading `https://example.com`")).toEqual(
      [],
    );
  });

  it("evaluates only autolink tokens selected by the changed-range filter", () => {
    expect(
      autolinkRanges(
        "https://first.example https://second.example",
        (from) => from > 0,
      ),
    ).toEqual([
      {
        from: 22,
        to: 44,
        href: "https://second.example",
      },
    ]);
  });

  it("preserves overlapping strong marks when auto-linking", () => {
    let state = createGFMarkdownState({
      context,
      value: "**https://example.com**",
    });
    state = state.apply(state.tr.insertText(" ", state.doc.content.size - 1));

    const linkedText = state.doc.firstChild?.firstChild;
    expect(linkedText?.marks.map((mark) => mark.type.name).sort()).toEqual([
      "link",
      "strong",
    ]);
    expect(gfmSchema.marks.link.isInSet(linkedText?.marks ?? [])?.attrs.href).toBe(
      "https://example.com",
    );
  });

  it("undoes auto-linking with the boundary that triggered it", () => {
    let state = typeText(
      createGFMarkdownState({ context, value: "" }),
      "https://example.com ",
    );
    expect(linkIsActive(
      state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, 2)),
      ),
    )).toBe(true);

    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(serializeMarkdown(state.doc)).toBe("");
    expect(
      redo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(serializeMarkdown(state.doc)).toBe("<https://example.com>&#x20;");
  });

  it("does not recreate an explicitly removed link after later typing", () => {
    let state = typeText(
      createGFMarkdownState({ context, value: "" }),
      "See https://example.com and more ",
    );
    const linkPosition = findTextPosition(state, "https://example.com");
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, linkPosition + 2)),
    );
    state = state.apply(removeLink(state, linkSelection(state)!));
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, state.doc.content.size - 1),
      ),
    );
    state = typeText(state, "later ");

    expect(linkIsActive(
      state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, linkPosition + 2)),
      ),
    )).toBe(false);
  });

  it("does not recreate an explicitly removed link after an unrelated paste", () => {
    let state = createGFMarkdownState({
      context,
      value: `First https://example.com paragraph.

Second paragraph.`,
    });
    const linkPosition = findTextPosition(state, "https://example.com");
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, linkPosition + 2)),
    );
    state = state.apply(removeLink(state, linkSelection(state)!));
    const secondPosition = findTextPosition(state, "Second paragraph.");
    state = state.apply(
      state.tr
        .insertText("Pasted ", secondPosition, secondPosition)
        .setMeta("uiEvent", "paste"),
    );

    expect(linkIsActive(
      state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, linkPosition + 2)),
      ),
    )).toBe(false);
  });

  it("indents task items in mixed lists", () => {
    let state = createGFMarkdownState({
      context,
      value: "- plain\n- [ ] task",
    });

    let taskPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.includes("task")) {
        taskPos = pos;
        return false;
      }
      return true;
    });

    expect(taskPos).toBeGreaterThan(0);

    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, taskPos + 1)),
    );

    const command = changeListIndent("indent");
    const canRun = command(state, undefined, undefined);
    expect(canRun).toBe(true);

    command(
      state,
      (tr) => {
        state = state.apply(tr);
      },
      undefined,
    );

    expect(state.doc.childCount).toBe(1);
    const rootList = state.doc.firstChild;
    expect(rootList?.type.name).toBe("bullet_list");
    expect(rootList?.childCount).toBe(1);

    const firstItem = rootList?.firstChild;
    expect(
      firstItem?.type.name === "list_item" ||
        (firstItem?.type.name === "task_list_item" &&
          firstItem?.attrs.checked === null),
    ).toBe(true);
    const nestedList = firstItem?.lastChild;
    expect(nestedList?.type.name).toBe("bullet_list");
    expect(nestedList?.firstChild?.type.name).toBe("task_list_item");
  });

  it("indents and outdents regular list levels", () => {
    let state = createGFMarkdownState({
      context,
      value: "- one\n- two",
    });

    let twoPos = -1;
    state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "two") {
        twoPos = pos;
        return false;
      }
      return true;
    });

    expect(twoPos).toBeGreaterThan(0);
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, twoPos + 1)),
    );

    const indent = changeListIndent("indent");
    expect(indent(state, undefined, undefined)).toBe(true);
    indent(
      state,
      (tr) => {
        state = state.apply(tr);
      },
      undefined,
    );

    const nestedAfterIndent = state.doc.firstChild?.firstChild?.lastChild;
    expect(nestedAfterIndent?.type.name).toBe("bullet_list");

    const outdent = changeListIndent("outdent");
    expect(outdent(state, undefined, undefined)).toBe(true);
    outdent(
      state,
      (tr) => {
        state = state.apply(tr);
      },
      undefined,
    );

    expect(state.doc.firstChild?.childCount).toBe(2);
  });

  it("handles Tab and Shift-Tab for list indentation", () => {
    let state = createGFMarkdownState({
      context,
      value: "- one\n- two",
    });

    const twoPos = findTextPosition(state, "two");
    expect(twoPos).toBeGreaterThan(0);
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, twoPos + 1)),
    );

    state = runKey(state, "Tab");
    expect(state.doc.firstChild?.firstChild?.lastChild?.type.name).toBe(
      "bullet_list",
    );

    state = runKey(state, "Shift-Tab");
    expect(state.doc.firstChild?.childCount).toBe(2);
  });

  it("outdents a nested item on Backspace without flattening descendants", () => {
    let state = createGFMarkdownState({
      context,
      value: `- parent
  - child
    - grandchild
- tail`,
    });
    const originalDoc = state.doc.toJSON();
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, findTextPosition(state, "child")),
      ),
    );

    state = runKey(state, "Backspace");

    expect(serializeMarkdown(state.doc)).toBe(`- parent
- child
  - grandchild
- tail`);
    const reparsed = createGFMarkdownState({
      context,
      value: serializeMarkdown(state.doc),
    });
    expect(reparsed.doc.toJSON()).toEqual(state.doc.toJSON());

    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(originalDoc);
  });

  it("preserves task state when Backspace outdents a mixed nested item", () => {
    let state = createGFMarkdownState({
      context,
      value: `- plain
  - [x] task
- tail`,
    });
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, findTextPosition(state, "task")),
      ),
    );

    state = runKey(state, "Backspace");

    expect(serializeMarkdown(state.doc)).toBe(`- plain
- [x] task
- tail`);
    expect(state.doc.firstChild?.child(1).type.name).toBe("task_list_item");
    expect(state.doc.firstChild?.child(1).attrs.checked).toBe(true);
  });

  it.each([
    {
      name: "task item nested under a plain item",
      markdown: `- parent
  - [x] child
- tail`,
      expected: `- parent
  - [x] child
- [ ]
- tail`,
      emptyType: "task_list_item",
    },
    {
      name: "plain item nested under a task item",
      markdown: `- [ ] parent
  - child
- tail`,
      expected: `- [ ] parent
  - child
-
- tail`,
      emptyType: "list_item",
    },
  ])(
    "outdents an empty $name on Enter without flattening it",
    ({ markdown, expected, emptyType }) => {
      let state = createGFMarkdownState({ context, value: markdown });
      const originalDoc = state.doc.toJSON();
      const childPos = findTextPosition(state, "child");
      state = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, childPos + 5)),
      );

      state = runKey(state, "Enter");
      state = state.apply(closeHistory(state.tr));
      state = runKey(state, "Enter");

      expect(serializeMarkdown(state.doc)).toBe(expected);
      expect(state.doc.firstChild?.child(1).type.name).toBe(emptyType);
      expect(state.doc.firstChild?.child(0).lastChild?.type.name).toBe(
        "bullet_list",
      );
      const serialized = serializeMarkdown(state.doc);
      expect(
        createGFMarkdownState({ context, value: serialized }).doc.toJSON(),
      ).toEqual(state.doc.toJSON());

      expect(
        undo(state, (transaction) => {
          state = state.apply(transaction);
        }),
      ).toBe(true);
      expect(
        undo(state, (transaction) => {
          state = state.apply(transaction);
        }),
      ).toBe(true);
      expect(state.doc.toJSON()).toEqual(originalDoc);
    },
  );

  it("splits checked tasks into an unchecked item and preserves descendants", () => {
    let state = createGFMarkdownState({
      context,
      value: `- [x] child
  - grandchild`,
    });
    const originalDoc = state.doc.toJSON();
    const childPos = findTextPosition(state, "child");
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, childPos + 2)),
    );

    state = runKey(state, "Enter");

    const list = state.doc.firstChild;
    expect(list?.childCount).toBe(2);
    expect(list?.child(0).attrs.checked).toBe(true);
    expect(list?.child(1).attrs.checked).toBe(false);
    expect(list?.child(1).lastChild?.type.name).toBe("bullet_list");
    expect(serializeMarkdown(state.doc)).toBe(`- [x] ch
- [ ] ild
  - grandchild`);
    expect(
      createGFMarkdownState({
        context,
        value: serializeMarkdown(state.doc),
      }).doc.toJSON(),
    ).toEqual(state.doc.toJSON());

    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(originalDoc);
  });

  it("preserves ordered starts when Enter exits an empty nested item", () => {
    let state = createGFMarkdownState({
      context,
      value: `- parent

  3. child

- tail`,
    });
    const childPos = findTextPosition(state, "child");
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, childPos + 5)),
    );

    state = runKey(state, "Enter");
    expect(
      state.doc.firstChild?.firstChild?.lastChild?.attrs.order,
    ).toBe(3);
    state = runKey(state, "Enter");

    expect(serializeMarkdown(state.doc)).toBe(`- parent

  3. child

-

- tail`);
    expect(
      state.doc.firstChild?.firstChild?.lastChild?.attrs.order,
    ).toBe(3);
    expect(
      createGFMarkdownState({
        context,
        value: serializeMarkdown(state.doc),
      }).doc.toJSON(),
    ).toEqual(state.doc.toJSON());
  });

  it("indents and outdents a mixed multi-item selection as sibling items", () => {
    let state = createGFMarkdownState({
      context,
      value: `- anchor
- [x] second

  3. descendant

- third
- [ ] fourth
- tail`,
    });
    const originalDoc = state.doc.toJSON();
    state = state.apply(
      state.tr.setSelection(
        TextSelection.create(
          state.doc,
          findTextPosition(state, "second"),
          findTextPosition(state, "fourth") + 6,
        ),
      ),
    );
    const selectedText = state.doc.textBetween(
      state.selection.from,
      state.selection.to,
      " ",
    );
    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
    } as unknown as EditorView;

    expect(
      changeListIndent("indent")(state, view.dispatch.bind(view), view),
    ).toBe(true);

    const rootList = state.doc.firstChild;
    const nestedList = rootList?.firstChild?.lastChild;
    expect(rootList?.childCount).toBe(2);
    expect(nestedList?.type.name).toBe("bullet_list");
    expect(nestedList?.childCount).toBe(3);
    expect(nestedList?.child(0).type.name).toBe("task_list_item");
    expect(nestedList?.child(0).attrs.checked).toBe(true);
    expect(nestedList?.child(0).lastChild?.type.name).toBe("ordered_list");
    expect(nestedList?.child(0).lastChild?.attrs.order).toBe(3);
    expect(nestedList?.child(2).type.name).toBe("task_list_item");
    expect(nestedList?.child(2).attrs.checked).toBe(false);
    expect(
      state.doc.textBetween(state.selection.from, state.selection.to, " "),
    ).toBe(selectedText);
    expect(
      createGFMarkdownState({
        context,
        value: serializeMarkdown(state.doc),
      }).doc.toJSON(),
    ).toEqual(state.doc.toJSON());

    const indentedDoc = state.doc.toJSON();
    state = state.apply(closeHistory(state.tr));
    expect(
      changeListIndent("outdent")(state, view.dispatch.bind(view), view),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(originalDoc);
    expect(
      state.doc.textBetween(state.selection.from, state.selection.to, " "),
    ).toBe(selectedText);

    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(indentedDoc);
    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(originalDoc);
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

function firstTextMarkNames(state: EditorState) {
  const textNode = state.doc.firstChild?.firstChild;

  return (textNode?.marks ?? []).map((mark) => mark.type.name);
}

function runKey(state: EditorState, keyName: string) {
  let currentState = state;
  const view = {
    get state() {
      return currentState;
    },
    dispatch(transaction: Transaction) {
      currentState = currentState.apply(transaction);
    },
  } as unknown as EditorView;

  for (const plugin of currentState.plugins) {
    const handler = plugin.props.handleKeyDown;
    if (
      handler?.call(
        plugin,
        view,
        new KeyboardEvent("keydown", {
          key: keyName === "Shift-Tab" ? "Tab" : keyName,
          shiftKey: keyName === "Shift-Tab",
        }),
      )
    ) {
      break;
    }
  }

  return currentState;
}

function findTextPosition(state: EditorState, text: string) {
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) {
      found = pos;
      return false;
    }

    return true;
  });
  return found;
}

function findNodePosition(state: EditorState, typeName: string) {
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (node.type.name === typeName) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

function linkIsActive(state: EditorState) {
  const selection = linkSelection(state);
  return selection !== null && selection.kind !== "new";
}
