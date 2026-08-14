import { closeHistory, redo, undo } from "prosemirror-history";
import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model";
import {
  AllSelection,
  EditorState,
  TextSelection,
  type Transaction,
} from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { describe, expect, it } from "vitest";
import {
  parseMarkdownClipboardText,
  serializeMarkdownClipboardSlice,
} from "../src/clipboard";
import { createGFMarkdownState, parseHTML } from "../src/editor";
import {
  changeListIndent,
  changeListType,
} from "../src/lists/commands";
import { parseMarkdown, serializeMarkdown } from "../src/markdown";
import { gfmSchema } from "../src/schema";

const context = { owner: "cschleiden", repo: "react-gfmd" };

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
});

describe("Backspace list boundaries", () => {
  it("outdents a mixed nested sibling without losing task state", () => {
    let state = createGFMarkdownState({
      context,
      value: `- parent
  - first
  - [x] second

    3. descendant
- tail`,
    });
    const original = state.doc.toJSON();
    state = withSelection(state, findTextPosition(state, "second"));

    state = runKey(state, "Backspace");

    state.doc.check();
    expect(serializeMarkdown(state.doc)).toBe(`- parent
  - first
- [x] second

  3. descendant
- tail`);
    expect(state.doc.firstChild?.child(1).type.name).toBe("task_list_item");
    expect(state.doc.firstChild?.child(1).attrs.checked).toBe(true);
    expect(state.doc.firstChild?.child(1).lastChild?.type.name).toBe(
      "ordered_list",
    );
    expect(state.doc.textContent).toContain("tail");
    expect(parseMarkdown(serializeMarkdown(state.doc)).toJSON()).toEqual(
      state.doc.toJSON(),
    );

    expect(
      undo(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);
    expect(state.doc.toJSON()).toEqual(original);
  });

  it("joins a later paragraph without moving nested descendants", () => {
    let state = createGFMarkdownState({
      context,
      value: `- first paragraph

  second paragraph

  - descendant
- tail`,
    });

    state = withSelection(state, findTextPosition(state, "second paragraph"));

    state = runKey(state, "Backspace");

    state.doc.check();
    const firstItem = state.doc.firstChild?.firstChild;
    expect(firstItem?.childCount).toBe(2);
    expect(firstItem?.firstChild?.textContent).toBe(
      "first paragraphsecond paragraph",
    );
    expect(firstItem?.lastChild?.type.name).toBe("bullet_list");
    expect(state.doc.firstChild?.child(1).textContent).toBe("tail");
    expect(parseMarkdown(serializeMarkdown(state.doc)).toJSON()).toEqual(
      state.doc.toJSON(),
    );
  });

  it("joins same-type nested siblings and keeps descendants attached", () => {
    let state = createGFMarkdownState({
      context,
      value: `- parent
  - first
  - second
    - descendant
- tail`,
    });
    const original = state.doc.toJSON();
    state = withSelection(state, findTextPosition(state, "second"));

    state = runKey(state, "Backspace");

    state.doc.check();
    const joined = state.doc.firstChild?.firstChild?.lastChild?.firstChild;
    expect(joined?.childCount).toBe(3);
    expect(joined?.child(0).textContent).toBe("first");
    expect(joined?.child(1).textContent).toBe("second");
    expect(joined?.child(2).type.name).toBe("bullet_list");
    expect(joined?.child(2).textContent).toBe("descendant");
    expect(joined?.attrs.spread).toBe(true);
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
    expect(state.doc.firstChild?.firstChild?.lastChild?.childCount).toBe(1);
  });

  it("does not rewrite metadata in an unrelated list on Backspace", () => {
    let state = createGFMarkdownState({
      context,
      value: `- unaffected
  > quote

between

- first
- second`,
    });
    const unaffected = state.doc.firstChild?.toJSON();
    state = withSelection(state, findTextPosition(state, "second"));

    state = runKey(state, "Backspace");

    expect(state.doc.firstChild?.toJSON()).toEqual(unaffected);
    expect(state.doc.firstChild?.firstChild?.attrs.spread).toBe(false);
  });

  it("exits the first top-level item without consuming adjacent siblings", () => {
    let state = createGFMarkdownState({
      context,
      value: `- first
- [ ] second
- tail`,
    });
    state = withSelection(state, findTextPosition(state, "first"));

    state = runKey(state, "Backspace");

    state.doc.check();
    expect(state.doc.firstChild?.type.name).toBe("paragraph");
    expect(state.doc.firstChild?.textContent).toBe("first");
    expect(state.doc.child(1).type.name).toBe("bullet_list");
    expect(state.doc.child(1).firstChild?.type.name).toBe("task_list_item");
    expect(state.doc.child(1).firstChild?.attrs.checked).toBe(false);
    expect(state.doc.child(1).lastChild?.textContent).toBe("tail");
  });

  it("preserves ordered numbering when the first top-level item exits", () => {
    let state = createGFMarkdownState({
      context,
      value: `3. first
4. second
5. third`,
    });
    state = withSelection(state, findTextPosition(state, "first"));

    state = runKey(state, "Backspace");

    expect(state.doc.firstChild?.type.name).toBe("paragraph");
    expect(state.doc.child(1).type.name).toBe("ordered_list");
    expect(state.doc.child(1).attrs.order).toBe(4);
    expect(serializeMarkdown(state.doc)).toBe(`first

4. second
5. third`);
  });

  it("preserves ordered numbering when exiting inside a blockquote", () => {
    let state = createGFMarkdownState({
      context,
      value: `> 3. first
> 4. second
> 5. third`,
    });
    state = withSelection(state, findTextPosition(state, "first"));

    state = runKey(state, "Backspace");

    const quote = state.doc.firstChild;
    expect(quote?.type.name).toBe("blockquote");
    expect(quote?.firstChild?.type.name).toBe("paragraph");
    expect(quote?.child(1).type.name).toBe("ordered_list");
    expect(quote?.child(1).attrs.order).toBe(4);
    expect(parseMarkdown(serializeMarkdown(state.doc)).toJSON()).toEqual(
      state.doc.toJSON(),
    );
  });

  it("does not detach descendants when a top-level item cannot safely exit", () => {
    let state = createGFMarkdownState({
      context,
      value: `- first
  - descendant
- tail`,
    });
    const original = state.doc.toJSON();
    state = withSelection(state, findTextPosition(state, "first"));

    state = runKey(state, "Backspace");

    expect(state.doc.toJSON()).toEqual(original);
    expect(state.selection.from).toBe(findTextPosition(state, "first"));
  });

  it("keeps an empty top-level item representable on Backspace", () => {
    let state = createGFMarkdownState({ context, value: "-\n- tail" });
    const original = state.doc.toJSON();
    let emptyParagraph = -1;
    state.doc.descendants((node, pos) => {
      if (node.type === gfmSchema.nodes.paragraph && node.content.size === 0) {
        emptyParagraph = pos + 1;
        return false;
      }
      return true;
    });
    state = withSelection(state, emptyParagraph);

    state = runKey(state, "Backspace");

    expect(state.doc.toJSON()).toEqual(original);
    expect(serializeMarkdown(state.doc)).toBe("-\n- tail");
  });
});

describe("generated mixed-list invariants", () => {
  for (const depth of [2, 3, 4, 5]) {
    it(`preserves semantic identity and convergence at depth ${depth}`, () => {
      const doc = generatedDocument(depth);
      doc.check();

      const markdown = serializeMarkdown(doc);
      const reparsed = parseMarkdown(markdown);

      expect(reparsed.toJSON()).toEqual(doc.toJSON());
      expect(serializeMarkdown(reparsed)).toBe(markdown);
    });

    it(`preserves structure through indent and outdent at depth ${depth}`, () => {
      let state = createGFMarkdownState({
        context,
        value: serializeMarkdown(generatedDocument(depth)),
      });
      const original = state.doc.toJSON();
      const selectedLabel = `depth-${depth}-second`;
      state = withSelection(state, findTextPosition(state, selectedLabel) + 2);
      const selectedText = state.doc.textBetween(
        state.selection.from,
        state.selection.to,
      );

      state = runCommand(state, changeListIndent("indent"));
      state.doc.check();
      expect(state.selection.$from.parent.textContent).toContain(selectedLabel);
      expect(state.doc.textContent).toContain(`depth-${depth - 1}-first`);
      expect(state.doc.textContent).toContain(`depth-${depth}-tail`);
      expect(
        parseMarkdown(serializeMarkdown(state.doc)).toJSON(),
      ).toEqual(state.doc.toJSON());
      const indented = state.doc.toJSON();

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
      expect(state.doc.toJSON()).toEqual(indented);

      state = state.apply(closeHistory(state.tr));
      state = runCommand(state, changeListIndent("outdent"));
      expect(state.doc.toJSON()).toEqual(original);
      expect(
        state.doc.textBetween(state.selection.from, state.selection.to),
      ).toBe(selectedText);

      expect(
        undo(state, (transaction) => {
          state = state.apply(transaction);
        }),
      ).toBe(true);
      expect(state.doc.toJSON()).toEqual(indented);
      expect(
        redo(state, (transaction) => {
          state = state.apply(transaction);
        }),
      ).toBe(true);
      expect(state.doc.toJSON()).toEqual(original);
    });

    it(`preserves descendants during list conversion at depth ${depth}`, () => {
      let state = createGFMarkdownState({
        context,
        value: serializeMarkdown(generatedDocument(depth)),
      });
      const unaffected = `depth-${depth}-tail`;
      const selected = `depth-${depth}-first`;
      state = withSelection(state, findTextPosition(state, selected) + 1);
      const beforeText = state.doc.textContent;
      const original = state.doc.toJSON();
      const currentList = nearestList(state, selected);
      const target =
        currentList?.type.name === "ordered_list" ? "bullet" : "ordered";

      state = runCommand(state, changeListType(target));

      state.doc.check();
      expect(state.doc.textContent).toBe(beforeText);
      expect(state.doc.textContent).toContain(unaffected);
      expect(parseMarkdown(serializeMarkdown(state.doc)).toJSON()).toEqual(
        state.doc.toJSON(),
      );
      expect(
        serializeMarkdown(parseMarkdown(serializeMarkdown(state.doc))),
      ).toBe(serializeMarkdown(state.doc));
      const converted = state.doc.toJSON();
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
      expect(state.doc.toJSON()).toEqual(converted);
    });
  }
});

describe("list metadata normalization", () => {
  it("keeps tight bullet lists tight when indenting", () => {
    let state = createGFMarkdownState({
      context,
      value: `- first
- second
- tail`,
    });
    state = withSelection(state, findTextPosition(state, "second"));

    state = runCommand(state, changeListIndent("indent"));

    expect(state.doc.firstChild?.attrs.tight).toBe(true);
    expect(state.doc.firstChild?.firstChild?.attrs.spread).toBe(false);
    expect(serializeMarkdown(state.doc)).toBe(`- first
  - second
- tail`);
    expect(parseMarkdown(serializeMarkdown(state.doc)).toJSON()).toEqual(
      state.doc.toJSON(),
    );
  });

  it("uses the selected ordinal when indenting ordered items", () => {
    let state = createGFMarkdownState({
      context,
      value: `4. first
5. second
6. tail`,
    });
    state = withSelection(state, findTextPosition(state, "second"));

    state = runCommand(state, changeListIndent("indent"));

    expect(state.doc.firstChild?.firstChild?.lastChild?.attrs.order).toBe(5);
    expect(parseMarkdown(serializeMarkdown(state.doc)).toJSON()).toEqual(
      state.doc.toJSON(),
    );
  });

  it("keeps ordered items structural when indenting under a bullet item", () => {
    let state = createGFMarkdownState({
      context,
      value: `- parent
  - previous
  2. selected`,
    });
    state = withSelection(state, findTextPosition(state, "selected"));

    state = runCommand(state, changeListIndent("indent"));

    const markdown = serializeMarkdown(state.doc);
    expect(state.doc.firstChild?.firstChild?.lastChild?.attrs.tight).toBe(true);
    expect(findNode(state.doc, "ordered_list")?.attrs.order).toBe(2);
    expect(parseMarkdown(markdown).toJSON()).toEqual(state.doc.toJSON());
  });

  it("moves complete multi-block items when indenting", () => {
    let state = createGFMarkdownState({
      context,
      value: `- first
- second paragraph

  second block
- tail`,
    });
    const original = state.doc.toJSON();
    state = withSelection(state, findTextPosition(state, "second paragraph"));

    state = runCommand(state, changeListIndent("indent"));

    const nestedItem = state.doc.firstChild?.firstChild?.lastChild?.firstChild;
    expect(nestedItem?.childCount).toBe(2);
    expect(nestedItem?.child(0).textContent).toBe("second paragraph");
    expect(nestedItem?.child(1).textContent).toBe("second block");
    expect(state.doc.firstChild?.lastChild?.textContent).toBe("tail");
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
    expect(
      state.doc.firstChild?.firstChild?.lastChild?.firstChild?.childCount,
    ).toBe(2);
  });

  it("does not rewrite unrelated spread metadata when outdenting", () => {
    const doc = parseHTML(
      `<ul data-tight="false"><li data-spread="true"><p>unaffected</p></li></ul>
<ul data-tight="true"><li data-spread="false"><p>parent</p><ul data-tight="true"><li data-spread="false"><p>child</p></li></ul></li></ul>`,
    );
    const plugins = createGFMarkdownState({ context, value: "" }).plugins;
    let state = EditorState.create({ doc, plugins });
    state = withSelection(state, findTextPosition(state, "child"));

    state = runCommand(state, changeListIndent("outdent"));

    expect(state.doc.firstChild?.firstChild?.attrs.spread).toBe(true);
    expect(state.doc.firstChild?.attrs.tight).toBe(false);
  });
});

function generatedDocument(maxDepth: number) {
  const generated = gfmSchema.nodes.doc.createChecked(
    null,
    generatedList(1, maxDepth),
  );
  return parseMarkdown(serializeMarkdown(generated));
}

function generatedList(depth: number, maxDepth: number): ProseMirrorNode {
  const ordered = depth % 2 === 0;
  const listType = ordered
    ? gfmSchema.nodes.ordered_list
    : gfmSchema.nodes.bullet_list;
  const nested =
    depth < maxDepth ? generatedList(depth + 1, maxDepth) : undefined;
  const firstParagraph = paragraph(`depth-${depth}-first`, depth);
  const firstContent = nested
    ? Fragment.fromArray([firstParagraph, nested])
    : Fragment.from(firstParagraph);
  const firstType =
    depth % 3 === 0
      ? gfmSchema.nodes.task_list_item
      : gfmSchema.nodes.list_item;
  const firstAttrs =
    firstType === gfmSchema.nodes.task_list_item
      ? { checked: depth % 2 === 1, spread: true }
      : { spread: true };
  const secondType =
    depth % 3 === 1
      ? gfmSchema.nodes.task_list_item
      : gfmSchema.nodes.list_item;
  const secondAttrs =
    secondType === gfmSchema.nodes.task_list_item
      ? { checked: depth % 2 === 0, spread: false }
      : { spread: false };
  const items = [
    firstType.createChecked(firstAttrs, firstContent),
    secondType.createChecked(secondAttrs, paragraph(`depth-${depth}-second`)),
    gfmSchema.nodes.list_item.createChecked(
      { spread: false },
      paragraph(`depth-${depth}-tail`),
    ),
  ];

  return listType.createChecked(
    ordered
      ? { order: depth + 2, tight: false }
      : { tight: false },
    Fragment.fromArray(items),
  );
}

function paragraph(text: string, depth = 0) {
  const marks =
    depth % 2 === 0
      ? [gfmSchema.marks.strong.create()]
      : [gfmSchema.marks.em.create()];
  return gfmSchema.nodes.paragraph.createChecked(
    null,
    gfmSchema.text(text, marks),
  );
}

function withSelection(state: EditorState, from: number, to = from) {
  return state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, from, to)),
  );
}

function runCommand(
  state: EditorState,
  command: ReturnType<typeof changeListIndent>,
) {
  let current = state;
  const view = {
    get state() {
      return current;
    },
    dispatch(transaction: Transaction) {
      current = current.apply(transaction);
    },
  } as unknown as EditorView;

  expect(command(current, view.dispatch.bind(view), view)).toBe(true);
  return current;
}

function runKey(state: EditorState, keyName: string) {
  let current = state;
  const view = {
    get state() {
      return current;
    },
    dispatch(transaction: Transaction) {
      current = current.apply(transaction);
    },
    endOfTextblock() {
      return current.selection.$from.parentOffset === 0;
    },
  } as unknown as EditorView;

  for (const plugin of current.plugins) {
    const handler = plugin.props.handleKeyDown;
    if (
      handler?.call(
        plugin,
        view,
        new KeyboardEvent("keydown", { key: keyName }),
      )
    ) {
      break;
    }
  }

  return current;
}

function findTextPosition(state: EditorState, text: string) {
  let found = -1;
  state.doc.descendants((node, pos) => {
    const offset = node.isText ? node.text?.indexOf(text) ?? -1 : -1;
    if (offset >= 0) {
      found = pos + offset;
      return false;
    }
    return true;
  });
  expect(found).toBeGreaterThanOrEqual(0);
  return found;
}

function nearestList(state: EditorState, text: string) {
  const $pos = state.doc.resolve(findTextPosition(state, text));
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth);
    if (
      node.type === gfmSchema.nodes.bullet_list ||
      node.type === gfmSchema.nodes.ordered_list
    ) {
      return node;
    }
  }
  return undefined;
}

function createEditorView(state: EditorState) {
  const mount = document.createElement("div");
  let view: EditorView;
  view = new EditorView(mount, {
    state,
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction));
    },
  });
  return view;
}

function findNode(doc: ProseMirrorNode, type: string) {
  let found: ProseMirrorNode | undefined;
  doc.descendants((node) => {
    if (node.type.name === type) {
      found = node;
      return false;
    }
    return true;
  });
  return found;
}

function pasteEvent() {
  return new Event("paste") as ClipboardEvent;
}
