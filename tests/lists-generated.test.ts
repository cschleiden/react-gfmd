import { closeHistory, redo, undo } from "prosemirror-history";
import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model";
import { describe, expect, it } from "vitest";
import { createGFMarkdownState } from "../src/editor";
import {
  changeListIndent,
  changeListType,
} from "../src/lists/commands";
import { parseMarkdown, serializeMarkdown } from "../src/markdown";
import { gfmSchema } from "../src/schema";
import {
  context,
  findTextPosition,
  nearestList,
  runCommand,
  withSelection,
} from "./list-test-helpers";

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
