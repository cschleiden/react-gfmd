import { redo, undo } from "prosemirror-history";
import { describe, expect, it } from "vitest";
import { createGFMarkdownState } from "../src/editor";
import { parseMarkdown, serializeMarkdown } from "../src/markdown";
import { gfmSchema } from "../src/schema";
import {
  context,
  findTextPosition,
  runKey,
  withSelection,
} from "./list-test-helpers";

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

  it("does not renumber an unrelated ordered list after a single-item exit", () => {
    let state = createGFMarkdownState({
      context,
      value: `3. only

1) unrelated`,
    });
    state = withSelection(state, findTextPosition(state, "only"));

    state = runKey(state, "Backspace");

    expect(state.doc.firstChild?.type.name).toBe("paragraph");
    expect(state.doc.child(1).type.name).toBe("ordered_list");
    expect(state.doc.child(1).attrs.order).toBe(1);
    expect(state.doc.child(1).textContent).toBe("unrelated");
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
