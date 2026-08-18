import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { undo } from "prosemirror-history";
import { DOMParser, DOMSerializer } from "prosemirror-model";
import {
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
  insertFootnote,
  insertFootnoteReference,
  renameFootnote,
  serializeMarkdown,
} from "../src";
import { navigateToFootnoteReference } from "../src/features/footnotes/plugin";

const context = { owner: "cschleiden", repo: "react-gfmd" };

describe("footnote editing", () => {
  it("renders GitHub-like references and structured definitions", () => {
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
    expect(
      screen.getByRole("region", {
        name: "Footnote note definition",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Footnote note; go to definition",
      }).textContent,
    ).toBe("1");
    expect(
      screen.getByRole("button", {
        name: "Edit footnote note label",
      }).textContent,
    ).toBe("note");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit footnote note label",
      }),
    );
    expect(
      screen.getByRole("textbox", {
        name: "Footnote note label",
      }),
    ).toBeTruthy();
    expect(screen.getByText("content").tagName).toBe("STRONG");
  });

  it("renders editable definitions after all document content", () => {
    const { container } = render(
      <GFMarkdownEditor
        context={context}
        value={"[^note]: Editable body.\n\nContent after the definition[^note]."}
      />,
    );

    const definition = container.querySelector(".gfmd-footnote-definition");
    const trailingBody = Array.from(container.querySelectorAll("p")).find(
      (paragraph) =>
        paragraph.textContent?.startsWith("Content after the definition"),
    );
    expect(definition).not.toBeNull();
    expect(trailingBody).toBeDefined();
    expect(
      trailingBody!.compareDocumentPosition(definition!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("inserts a collision-free footnote from the toolbar", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value={"Existing[^1].\n\n[^1]: First."}
      />,
    );

    fireEvent.click(screen.getByTitle("Insert footnote"));
    fireEvent.click(screen.getByText("New footnote"));

    expect(
      screen.getByRole("button", {
        name: "Footnote 2; go to definition",
      }),
    ).toBeTruthy();
    expect(onChange.mock.lastCall?.[0]).toContain("[^2]");
    expect(onChange.mock.lastCall?.[0]).toContain("[^2]:");
  });

  it("inserts another reference to an existing footnote from the toolbar", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value={"Existing[^note].\n\n[^note]: Shared definition."}
      />,
    );

    fireEvent.click(screen.getByTitle("Insert footnote"));
    fireEvent.click(screen.getByText("[^note]"));

    expect(
      screen.getAllByRole("button", {
        name: "Footnote note; go to definition",
      }),
    ).toHaveLength(2);
    expect(onChange.mock.lastCall?.[0]).toContain(
      "[^note]Existing[^note].",
    );
    expect(onChange.mock.lastCall?.[0].match(/\[\^note\]:/g)).toHaveLength(1);
    expect(
      screen.getByRole("button", {
        name: "Go to reference 2 of 2 for footnote note",
      }),
    ).toBeTruthy();
  });

  it("synchronizes definition label edits across matching nodes", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value={"One[^note], two[^note].\n\n[^note]: Body."}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit footnote note label",
      }),
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Footnote note label",
      }),
      { target: { value: "renamed-note" } },
    );

    expect(
      screen.getAllByRole("button", {
        name: "Footnote renamed-note; go to definition",
      }),
    ).toHaveLength(2);
    expect(onChange).toHaveBeenLastCalledWith(
      "One[^renamed-note], two[^renamed-note].\n\n[^renamed-note]: Body.",
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      screen.getAllByRole("button", {
        name: "Footnote note; go to definition",
      }),
    ).toHaveLength(2);
    expect(onChange).toHaveBeenLastCalledWith(
      "One[^note], two[^note].\n\n[^note]: Body.",
      expect.anything(),
    );
  });

  it("rejects label collisions", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value={"A[^a] B[^b].\n\n[^a]: Alpha.\n\n[^b]: Beta."}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit footnote a label",
      }),
    );
    const collisionInput = screen.getByRole("textbox", {
      name: "Footnote a label",
    });
    fireEvent.change(collisionInput, { target: { value: "b" } });
    expect((collisionInput as HTMLInputElement).validationMessage).toContain(
      "already uses",
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rejects labels that cannot round-trip", () => {
    const onChange = vi.fn();
    render(
      <GFMarkdownEditor
        context={context}
        onChange={onChange}
        value={"See[^note].\n\n[^note]: Body."}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit footnote note label",
      }),
    );
    const invalidInput = screen.getByRole("textbox", {
      name: "Footnote note label",
    });
    fireEvent.change(invalidInput, { target: { value: "two words" } });
    expect((invalidInput as HTMLInputElement).validationMessage).toContain(
      "without spaces or brackets",
    );
    fireEvent.blur(invalidInput);
    expect(
      screen.getByRole("textbox", {
        name: "Footnote note label",
      }),
    ).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes an unchanged label editor on blur", () => {
    render(
      <GFMarkdownEditor
        context={context}
        value={"See[^note].\n\n[^note]: Body."}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit footnote note label",
      }),
    );

    fireEvent.blur(
      screen.getByRole("textbox", {
        name: "Footnote note label",
      }),
    );

    expect(
      screen.queryByRole("textbox", {
        name: "Footnote note label",
      }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Edit footnote note label",
      }),
    ).toBeTruthy();
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
      screen.getByRole("region", { name: "Footnote note definition" }),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Go to reference 1 of 1 for footnote note",
      }),
    );
    expect(
      document.querySelector(".gfmd-footnote-reference[data-selected]"),
    ).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", {
        name: "Footnote note; go to definition",
      }),
    );
  });

  it("selects only the reference marker when navigating back", () => {
    let state = createGFMarkdownState({
      context,
      value: "See[^note].\n\n[^note]: Body.",
    });
    const referencePos = findNodePosition(state, "footnote_reference");

    const view = {
      get state() {
        return state;
      },
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
      },
      focus: vi.fn(),
      nodeDOM: vi.fn(() => null),
    } as unknown as EditorView;
    navigateToFootnoteReference(view, referencePos);

    expect(state.selection).toBeInstanceOf(TextSelection);
    expect(state.selection.from).toBe(referencePos);
    expect(state.selection.to).toBe(referencePos + 1);
  });

  it("lists a compact navigation control for every reference", () => {
    render(
      <GFMarkdownEditor
        context={context}
        value={"First[^note], second[^note].\n\n[^note]: Body."}
      />,
    );

    const first = screen.getByRole("button", {
      name: "Go to reference 1 of 2 for footnote note",
    });
    const second = screen.getByRole("button", {
      name: "Go to reference 2 of 2 for footnote note",
    });
    expect(first.textContent).toBe("↩");
    expect(second.textContent).toBe("↩2");
    expect(first.closest("p")).not.toBeNull();

    fireEvent.click(second);
    const references = document.querySelectorAll(".gfmd-footnote-reference");
    expect(
      Array.from(references).some((reference) =>
        reference.hasAttribute("data-selected"),
      ),
    ).toBe(false);
  });

  it("preserves explicit orphans when either side is deleted", () => {
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

  it("undoes insertion and synchronized rename atomically", () => {
    let state = createGFMarkdownState({ context, value: "Text" });
    const original = state.doc.toJSON();
    insertFootnote(state, (transaction) => {
      state = state.apply(transaction);
    });
    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(original);

    state = createGFMarkdownState({
      context,
      value: "One[^note] two[^note].\n\n[^note]: Body.",
    });
    const beforeRename = state.doc.toJSON();
    renameFootnote("note", "renamed")(state, (transaction) => {
      state = state.apply(transaction);
    });
    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(beforeRename);
  });

  it("inserts after selected content without deleting it", () => {
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

  it("inserts another reference without duplicating its definition", () => {
    let state = createGFMarkdownState({
      context,
      value: "See[^note].\n\n[^note]: Shared.",
    });

    insertFootnoteReference("note")(state, (transaction) => {
      state = state.apply(transaction);
    });

    let referenceCount = 0;
    state.doc.descendants((node) => {
      if (node.type.name === "footnote_reference") referenceCount += 1;
    });
    expect(referenceCount).toBe(2);
    expect(serializeMarkdown(state.doc).match(/\[\^note\]:/g)).toHaveLength(1);
  });

  it("keeps definitions at the end after document edits", () => {
    let state = createGFMarkdownState({
      context,
      value: "Body[^note].\n\n[^note]: Definition.",
    });
    const trailingParagraph = gfmSchema.nodes.paragraph.create(
      null,
      gfmSchema.text("Trailing body."),
    );

    const insertPos = state.doc.content.size;
    const tr = state.tr.insert(insertPos, trailingParagraph);
    tr.setSelection(
      TextSelection.create(tr.doc, insertPos + 1),
    );
    state = state.apply(tr);

    expect(state.doc.lastChild?.type).toBe(gfmSchema.nodes.footnote_definition);
    expect(state.doc.child(state.doc.childCount - 2).textContent).toBe(
      "Trailing body.",
    );
    expect(serializeMarkdown(state.doc)).toBe(
      "Body[^note].\n\nTrailing body.\n\n[^note]: Definition.",
    );
    expect(state.selection.$from.parent.textContent).toBe("Trailing body.");
  });

  it("does not insert another reference for an orphan identifier", () => {
    const state = createGFMarkdownState({
      context,
      value: "See[^orphan].",
    });

    expect(insertFootnoteReference("orphan")(state)).toBe(false);
  });

  it("round-trips copied footnote DOM without losing content", () => {
    const doc = createGFMarkdownState({
      context,
      value: "See[^note].\n\n[^note]: First.\n\n    Second.",
    }).doc;
    const container = document.createElement("div");
    container.append(
      DOMSerializer.fromSchema(gfmSchema).serializeFragment(doc.content),
    );

    expect(
      DOMParser.fromSchema(gfmSchema).parse(container).toJSON(),
    ).toEqual(doc.toJSON());
  });

  it("replaces node views on controlled value updates", async () => {
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

  it("renumbers references when definition order changes", async () => {
    const { rerender } = render(
      <GFMarkdownEditor
        context={context}
        value={
          "First[^first], second[^second].\n\n[^first]: One.\n\n[^second]: Two."
        }
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Footnote second; go to definition",
      }).textContent,
    ).toBe("2");

    rerender(
      <GFMarkdownEditor
        context={context}
        value={"Only second[^second].\n\n[^second]: Two."}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Footnote second; go to definition",
        }).textContent,
      ).toBe("1");
    });
  });
});

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
