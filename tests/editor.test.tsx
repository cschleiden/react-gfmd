import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { closeHistory, redo, undo } from "prosemirror-history";
import { DOMParser, DOMSerializer } from "prosemirror-model";
import { TextSelection, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { describe, expect, it, vi } from "vitest";
import {
  createGFMarkdownState,
  GFMarkdownEditor,
  gfmSchema,
  insertFootnote,
  renameFootnote,
  serializeMarkdown,
} from "../src";
import {
  changeListIndent,
  changeListType,
  currentListKind,
} from "../src/lists/commands";

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

  it("renders accessible editable footnote references and definitions", () => {
    render(
      <GFMarkdownEditor
        context={context}
        value={"See this[^note].\n\n[^note]: Editable **content**."}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Footnote note; go to definition",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("region", {
      name: "Footnote note definition",
    })).toBeTruthy();
    expect(screen.getByRole("textbox", {
      name: "Footnote note label",
    })).toBeTruthy();
    expect(screen.getByText("content").tagName).toBe("STRONG");
  });

  it("inserts a collision-free footnote and focuses its editable definition", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value={"Existing[^1].\n\n[^1]: First."}
      />,
    );

    fireEvent.click(screen.getByTitle("Insert footnote"));

    expect(
      screen.getByRole("button", {
        name: "Footnote 2; go to definition",
      }),
    ).toBeTruthy();
    expect(document.activeElement?.classList.contains("gfmd-editor-surface")).toBe(
      true,
    );
    expect(onChange.mock.lastCall?.[0]).toContain("[^2]");
    expect(onChange.mock.lastCall?.[0]).toContain("[^2]:");
  });

  it("synchronizes definition label edits across multiple references", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value={"One[^note], two[^note].\n\n[^note]: Body."}
      />,
    );

    const input = screen.getByRole("textbox", {
      name: "Footnote note label",
    });
    fireEvent.change(input, { target: { value: "renamed-note" } });

    expect(
      screen.getAllByRole("button", {
        name: "Footnote renamed-note; go to definition",
      }),
    ).toHaveLength(2);
    expect(onChange).toHaveBeenLastCalledWith(
      "One[^renamed-note], two[^renamed-note].\n\n[^renamed-note]: Body.",
      expect.anything(),
    );
  });

  it("rejects footnote label collisions without changing either footnote", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value={"A[^a] B[^b].\n\n[^a]: Alpha.\n\n[^b]: Beta."}
      />,
    );

    const input = screen.getByRole("textbox", { name: "Footnote a label" });
    fireEvent.change(input, { target: { value: "b" } });

    expect((input as HTMLInputElement).validationMessage).toContain(
      "already uses",
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Footnote a; go to definition" }),
    ).toBeTruthy();
  });

  it("rejects labels that cannot round-trip through GFM footnote syntax", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value={"See[^note].\n\n[^note]: Body."}
      />,
    );

    const input = screen.getByRole("textbox", {
      name: "Footnote note label",
    });
    fireEvent.change(input, { target: { value: "two words" } });

    expect((input as HTMLInputElement).validationMessage).toContain(
      "without spaces or brackets",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("navigates between references and definitions", () => {
    render(
      <GFMarkdownEditor
        context={context}
        value={"See[^note].\n\n[^note]: Body."}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Footnote note; go to definition",
      }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Footnote note label" }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Go to reference for footnote note",
      }),
    );
    expect(
      document.querySelector(".gfmd-footnote-reference[data-selected]"),
    ).toBeTruthy();
  });

  it("preserves explicit orphan references and definitions on deletion", () => {
    let state = createGFMarkdownState({
      context,
      value: "See[^note].\n\n[^note]: Keep this body.",
    });
    const referencePos = findNodePosition(state, "footnote_reference");
    state = state.apply(state.tr.delete(referencePos, referencePos + 1));
    expect(serializeMarkdown(state.doc)).toBe(
      "See.\n\n[^note]: Keep this body.",
    );

    state = createGFMarkdownState({
      context,
      value: "See[^note].\n\n[^note]: Keep this body.",
    });
    const definitionPos = findNodePosition(state, "footnote_definition");
    const definition = state.doc.nodeAt(definitionPos)!;
    state = state.apply(
      state.tr.delete(definitionPos, definitionPos + definition.nodeSize),
    );
    expect(serializeMarkdown(state.doc)).toBe("See[^note].");
  });

  it("undoes footnote insertion and synchronized rename as single changes", () => {
    let state = createGFMarkdownState({ context, value: "Text" });
    const original = state.doc.toJSON();
    insertFootnote(state, (transaction) => {
      state = state.apply(transaction);
    });

    expect(undo(state, (transaction) => {
      state = state.apply(transaction);
    })).toBe(true);
    expect(state.doc.toJSON()).toEqual(original);

    state = createGFMarkdownState({
      context,
      value: "One[^note] two[^note].\n\n[^note]: Body.",
    });
    const beforeRename = state.doc.toJSON();
    renameFootnote("note", "renamed")(state, (transaction) => {
      state = state.apply(transaction);
    });
    expect(undo(state, (transaction) => {
      state = state.apply(transaction);
    })).toBe(true);
    expect(state.doc.toJSON()).toEqual(beforeRename);
  });

  it("inserts a footnote without deleting selected content", () => {
    let state = createGFMarkdownState({
      context,
      value: "Keep selected text",
    });
    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 1, 5)),
    );

    insertFootnote(state, (transaction) => {
      state = state.apply(transaction);
    });

    expect(serializeMarkdown(state.doc)).toContain("Keep[^1] selected text");
  });

  it("round-trips copied footnote DOM without losing identifiers or content", () => {
    const doc = createGFMarkdownState({
      context,
      value: "See[^note].\n\n[^note]: First.\n\n    Second.",
    }).doc;
    const container = document.createElement("div");
    container.append(
      DOMSerializer.fromSchema(gfmSchema).serializeFragment(doc.content),
    );
    const reparsed = DOMParser.fromSchema(gfmSchema).parse(container);

    expect(reparsed.toJSON()).toEqual(doc.toJSON());
  });

  it("replaces footnote node views on controlled value updates", async () => {
    const { rerender } = render(
      <GFMarkdownEditor
        context={context}
        value={"See[^old].\n\n[^old]: Old body."}
      />,
    );

    rerender(
      <GFMarkdownEditor
        context={context}
        value={"See[^new].\n\n[^new]: New body."}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Footnote new; go to definition",
        }),
      ).toBeTruthy();
    });
    expect(screen.queryByText("Old body.")).toBeNull();
    expect(screen.getByText("New body.")).toBeTruthy();
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
