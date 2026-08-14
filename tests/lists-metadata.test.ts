import { redo, undo } from "prosemirror-history";
import { EditorState } from "prosemirror-state";
import { describe, expect, it } from "vitest";
import { createGFMarkdownState, parseHTML } from "../src/editor";
import { changeListIndent } from "../src/lists/commands";
import { parseMarkdown, serializeMarkdown } from "../src/markdown";
import {
  context,
  findNode,
  findTextPosition,
  runCommand,
  withSelection,
} from "./list-test-helpers";

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
