import { redo, undo } from "prosemirror-history";
import { AllSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { describe, expect, it } from "vitest";
import {
  parseMarkdownClipboardText,
  serializeMarkdownClipboardSlice,
} from "../src/clipboard";
import { createGFMarkdownState, parseHTML } from "../src/editor";
import { parseMarkdown, serializeMarkdown } from "../src/markdown";
import { gfmSchema } from "../src/schema";
import {
  context,
  createEditorView,
  findNode,
  findTextPosition,
  pasteEvent,
  withSelection,
} from "./list-test-helpers";

describe("nested list clipboard behavior", () => {
  it("serializes a partial mixed-list selection as Markdown with its topology", () => {
    let state = createGFMarkdownState({
      context,
      value: `- before
- [x] **task**

  second paragraph

  3. ordered
     - [ ] deep
- after`,
    });
    const from = findTextPosition(state, "task");
    const to = findTextPosition(state, "deep") + "deep".length;
    state = withSelection(state, from, to);

    const slice = state.selection.content();
    const markdown = serializeMarkdownClipboardSlice(slice, state.selection);
    const copiedDoc = parseMarkdown(markdown);

    expect(markdown).toContain("**task**");
    expect(markdown).not.toContain("- [x] **task**");
    expect(markdown).toContain("3. ordered");
    expect(markdown).toContain("- [ ] deep");
    expect(copiedDoc.firstChild?.type.name).toBe("paragraph");
    expect(findNode(copiedDoc, "task_list_item")?.attrs.checked).toBe(false);
    expect(findNode(copiedDoc, "bullet_list")).toBeDefined();
    expect(serializeMarkdown(parseMarkdown(markdown))).toBe(markdown);
  });

  it("copies task text without materializing its task wrapper", () => {
    let state = createGFMarkdownState({ context, value: "- [x] task" });
    state = withSelection(
      state,
      findTextPosition(state, "task"),
      findTextPosition(state, "task") + "task".length,
    );

    expect(
      serializeMarkdownClipboardSlice(
        state.selection.content(),
        state.selection,
      ),
    ).toBe("task");
  });

  it("preserves checked state when the complete task list is copied", () => {
    let state = createGFMarkdownState({
      context,
      value: `- [x] task
  - descendant`,
    });
    state = state.apply(
      state.tr.setSelection(new AllSelection(state.doc)),
    );

    expect(
      serializeMarkdownClipboardSlice(
        state.selection.content(),
        state.selection,
      ),
    ).toBe(`- [x] task
  - descendant`);
  });

  it("does not materialize unselected ancestors around copied text", () => {
    let state = createGFMarkdownState({
      context,
      value: `- parent
  - child`,
    });
    state = withSelection(
      state,
      findTextPosition(state, "child"),
      findTextPosition(state, "child") + "child".length,
    );

    expect(
      serializeMarkdownClipboardSlice(
        state.selection.content(),
        state.selection,
      ),
    ).toBe("child");
  });

  it("copies multiple selected paragraphs without a fabricated list item", () => {
    let state = createGFMarkdownState({
      context,
      value: `- first paragraph

  second paragraph`,
    });
    state = withSelection(
      state,
      findTextPosition(state, "first paragraph"),
      findTextPosition(state, "second paragraph") + "second paragraph".length,
    );

    expect(
      serializeMarkdownClipboardSlice(
        state.selection.content(),
        state.selection,
      ),
    ).toBe(`first paragraph

second paragraph`);
  });

  it("starts partial ordered-list copies at the selected ordinal", () => {
    let state = createGFMarkdownState({
      context,
      value: `3. three
4. four
5. five
6. six`,
    });
    state = withSelection(
      state,
      findTextPosition(state, "five"),
      findTextPosition(state, "six") + "six".length,
    );

    expect(
      serializeMarkdownClipboardSlice(
        state.selection.content(),
        state.selection,
      ),
    ).toBe(`5. five
6. six`);
  });

  it("parses plain-text Markdown into a pasteable mixed-list slice", () => {
    const markdown = `4. **ordered**

   - [x] task

     second paragraph

- tail`;
    const expected = parseMarkdown(markdown);
    const slice = parseMarkdownClipboardText(markdown);
    let state = createGFMarkdownState({ context, value: "" });

    state = state.apply(state.tr.replaceSelection(slice));

    expect(state.doc.toJSON()).toEqual(expected.toJSON());
    expect(state.doc.firstChild?.attrs.order).toBe(4);
    expect(
      state.doc.firstChild?.firstChild?.lastChild?.firstChild?.attrs.checked,
    ).toBe(true);
    expect(
      state.doc.firstChild?.firstChild?.lastChild?.firstChild?.attrs.spread,
    ).toBe(true);
    expect(serializeMarkdown(state.doc)).toBe(serializeMarkdown(expected));
  });

  it("wires Markdown clipboard hooks into the editor state", () => {
    let source = createGFMarkdownState({
      context,
      value: `- [x] **task**

  4. ordered
     - deep`,
    });
    source = withSelection(
      source,
      findTextPosition(source, "task"),
      findTextPosition(source, "deep") + "deep".length,
    );
    const plugin = source.plugins.find(
      (candidate) =>
        candidate.props.clipboardTextParser &&
        candidate.props.clipboardTextSerializer,
    );
    expect(plugin).toBeDefined();

    const view = { state: source } as EditorView;
    const text = plugin?.props.clipboardTextSerializer?.call(
      plugin,
      source.selection.content(),
      view,
    );
    const parsed = plugin?.props.clipboardTextParser?.call(
      plugin,
      text ?? "",
      source.selection.$from,
      true,
      view,
    );

    expect(text).toContain("**task**");
    expect(text).not.toContain("- [x] **task**");
    expect(text).toContain("4. ordered");
    expect(parsed?.content.firstChild?.type.name).toBe("paragraph");
    expect(parsed?.content.textBetween(0, parsed.content.size, " ")).toContain(
      "deep",
    );
  });

  it("pastes mixed Markdown beside unaffected list siblings", () => {
    const markdown = `- [ ] task
  7. ordered
- plain`;
    let state = createGFMarkdownState({
      context,
      value: `- before
-
- after`,
    });
    let emptyParagraph = -1;
    state.doc.descendants((node, pos) => {
      if (node.type === gfmSchema.nodes.paragraph && node.content.size === 0) {
        emptyParagraph = pos + 1;
        return false;
      }
      return true;
    });
    state = withSelection(state, emptyParagraph);
    const view = createEditorView(state);

    expect(view.pasteText(markdown, pasteEvent())).toBe(true);
    state = view.state;
    view.destroy();

    state.doc.check();
    expect(state.doc.textContent).toContain("before");
    expect(state.doc.textContent).toContain("task");
    expect(state.doc.textContent).toContain("ordered");
    expect(state.doc.textContent).toContain("plain");
    expect(state.doc.textContent).toContain("after");
    expect(parseMarkdown(serializeMarkdown(state.doc)).toJSON()).toEqual(
      state.doc.toJSON(),
    );
  });

  it("round-trips partial selections through ProseMirror HTML clipboard data", () => {
    let sourceState = createGFMarkdownState({
      context,
      value: `- before
- [x] **task**

  second paragraph

  3. ordered
     - [ ] deep
- after`,
    });
    sourceState = withSelection(
      sourceState,
      findTextPosition(sourceState, "task"),
      findTextPosition(sourceState, "deep") + "deep".length,
    );
    const sourceView = createEditorView(sourceState);
    const copied = sourceView.serializeForClipboard(
      sourceState.selection.content(),
    );
    const targetView = createEditorView(
      createGFMarkdownState({ context, value: "" }),
    );

    expect(targetView.pasteHTML(copied.dom.innerHTML, pasteEvent())).toBe(true);

    const pasted = targetView.state.doc;
    pasted.check();
    expect(pasted.textContent).toContain("task");
    expect(pasted.textContent).toContain("second paragraph");
    expect(pasted.textContent).toContain("ordered");
    expect(pasted.textContent).toContain("deep");
    expect(findNode(pasted, "task_list_item")?.attrs.checked).toBe(true);
    expect(findNode(pasted, "ordered_list")?.attrs.order).toBe(3);
    expect(parseMarkdown(serializeMarkdown(pasted)).toJSON()).toEqual(
      pasted.toJSON(),
    );

    sourceView.destroy();
    targetView.destroy();
  });

  it("parses GitHub-rendered task-list HTML with checked state", () => {
    const doc = parseHTML(
      `<ul><li class="task-list-item"><input type="checkbox" checked>done</li></ul>`,
    );

    expect(doc.firstChild?.firstChild?.type.name).toBe("task_list_item");
    expect(doc.firstChild?.firstChild?.attrs.checked).toBe(true);
    expect(doc.firstChild?.firstChild?.textContent).toBe("done");
  });

  it("preserves loose-list metadata through ProseMirror HTML clipboard data", () => {
    let sourceState = createGFMarkdownState({
      context,
      value: `- one

- two`,
    });
    sourceState = sourceState.apply(
      sourceState.tr.setSelection(new AllSelection(sourceState.doc)),
    );
    const sourceView = createEditorView(sourceState);
    const copied = sourceView.serializeForClipboard(
      sourceState.selection.content(),
    );
    const targetView = createEditorView(
      createGFMarkdownState({ context, value: "" }),
    );

    expect(targetView.pasteHTML(copied.dom.innerHTML, pasteEvent())).toBe(true);

    expect(targetView.state.doc.firstChild?.attrs.tight).toBe(false);
    expect(targetView.state.doc.toJSON()).toEqual(sourceState.doc.toJSON());
    sourceView.destroy();
    targetView.destroy();
  });

  it("keeps unaffected siblings valid when cutting a nested partial selection", () => {
    let state = createGFMarkdownState({
      context,
      value: `- before
- parent
  - [x] child
    - descendant
  - nested sibling
- after`,
    });
    const original = state.doc.toJSON();
    state = withSelection(
      state,
      findTextPosition(state, "child"),
      findTextPosition(state, "descendant") + "descendant".length,
    );

    const copied = serializeMarkdownClipboardSlice(state.selection.content());
    state = state.apply(state.tr.deleteSelection());

    state.doc.check();
    expect(copied).toContain("child");
    expect(copied).not.toContain("- [x] child");
    expect(copied).toContain("- descendant");
    expect(state.doc.textContent).toContain("before");
    expect(state.doc.textContent).toContain("nested sibling");
    expect(state.doc.textContent).toContain("after");
    expect(parseMarkdown(serializeMarkdown(state.doc)).toJSON()).toEqual(
      state.doc.toJSON(),
    );

    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(original);
    expect(
      redo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.textContent).toContain("nested sibling");
  });

  it("isolates paste from adjacent typing in history", () => {
    const view = createEditorView(createGFMarkdownState({ context, value: "" }));
    view.dispatch(view.state.tr.insertText("typed "));

    startPaste(view);
    expect(view.pasteText("paste", pasteEvent())).toBe(true);
    view.dispatch(view.state.tr.insertText(" after"));
    expect(serializeMarkdown(view.state.doc)).toBe("typed paste after");

    expect(undo(view.state, (transaction) => view.dispatch(transaction))).toBe(
      true,
    );
    expect(serializeMarkdown(view.state.doc)).toBe("typed paste");
    expect(undo(view.state, (transaction) => view.dispatch(transaction))).toBe(
      true,
    );
    expect(serializeMarkdown(view.state.doc)).toBe("typed&#x20;");
    expect(undo(view.state, (transaction) => view.dispatch(transaction))).toBe(
      true,
    );
    expect(serializeMarkdown(view.state.doc)).toBe("");

    expect(redo(view.state, (transaction) => view.dispatch(transaction))).toBe(
      true,
    );
    expect(serializeMarkdown(view.state.doc)).toBe("typed&#x20;");
    expect(redo(view.state, (transaction) => view.dispatch(transaction))).toBe(
      true,
    );
    expect(serializeMarkdown(view.state.doc)).toBe("typed paste");
    view.destroy();
  });

  it("closes native paste history without UI event metadata", () => {
    const view = createEditorView(createGFMarkdownState({ context, value: "" }));
    view.dispatch(view.state.tr.insertText("typed "));

    Object.defineProperty(view, "composing", {
      configurable: true,
      value: true,
    });
    startPaste(view);
    view.dispatch(view.state.tr.insertText("paste").setMeta("composition", 1));
    view.dispatch(view.state.tr.insertText(" after"));
    expect(serializeMarkdown(view.state.doc)).toBe("typed paste after");

    expect(undo(view.state, (transaction) => view.dispatch(transaction))).toBe(
      true,
    );
    expect(serializeMarkdown(view.state.doc)).toBe("typed paste");
    expect(undo(view.state, (transaction) => view.dispatch(transaction))).toBe(
      true,
    );
    expect(serializeMarkdown(view.state.doc)).toBe("typed&#x20;");
    view.destroy();
  });

  it("does not split typing after a clipboard event changes nothing", async () => {
    const view = createEditorView(createGFMarkdownState({ context, value: "" }));
    view.dispatch(view.state.tr.insertText("a"));

    startPaste(view);
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    view.dispatch(view.state.tr.insertText("bc"));
    expect(serializeMarkdown(view.state.doc)).toBe("abc");

    expect(undo(view.state, (transaction) => view.dispatch(transaction))).toBe(
      true,
    );
    expect(serializeMarkdown(view.state.doc)).toBe("");
    view.destroy();
  });
});

function startPaste(view: EditorView) {
  for (const plugin of view.state.plugins) {
    plugin.props.handleDOMEvents?.paste?.call(plugin, view, pasteEvent());
  }
}
