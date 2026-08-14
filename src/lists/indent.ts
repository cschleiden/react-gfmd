import type { Node as ProseMirrorNode, ResolvedPos } from "prosemirror-model";
import { Fragment, NodeRange, Slice } from "prosemirror-model";
import {
  EditorState,
  TextSelection,
  type Command,
  type Transaction,
} from "prosemirror-state";
import { canJoin, liftTarget, ReplaceAroundStep } from "prosemirror-transform";
import type { EditorView } from "prosemirror-view";
import { gfmSchema } from "../schema";
import { isListItemNode, isListNode } from "./utils";

export function changeListIndent(direction: "indent" | "outdent"): Command {
  return (state, dispatch, view) =>
    runListIndentOnce(direction, state, dispatch, view);
}

function runListIndentOnce(
  direction: "indent" | "outdent",
  state: EditorState,
  dispatch?: EditorView["dispatch"],
  _view?: EditorView,
) {
  const tr = state.tr;
  const changed = direction === "indent" ? indentList(tr) : dedentList(tr);
  if (!changed) return false;

  dispatch?.(tr.scrollIntoView());
  return true;
}

function calculateItemRange(selection: EditorState["selection"]) {
  const { $from, $to } = selection;
  return $from.blockRange($to, isListNode);
}

function indentList(tr: Transaction) {
  const { $from, $to } = tr.selection;
  const range = calculateItemRange(tr.selection);
  if (!range) return false;

  const selectedList = tr.doc.resolve(range.start).node();
  if (!isListNode(selectedList)) return false;

  const previous = findPreviousItem(selectedList, $from, range);
  if (!previous) return false;

  const {
    previousItem,
    previousList,
    previousItemStart,
    previousListStart,
  } = previous;
  const selectedSlice = tr.doc.slice(range.start, range.end);

  const newPreviousItemContent = previousItem.content
    .append(
      Fragment.fromArray([
        copyListForIndent(selectedList, selectedSlice, range.startIndex),
      ]),
    );

  tr.deleteRange(range.start, range.end);

  const previousItemEnd = previousItemStart + previousItem.nodeSize - 2;
  const requiresLooseNesting =
    selectedList.type === gfmSchema.nodes.ordered_list;
  const newPreviousItem = previousItem.type.create(
    requiresLooseNesting
      ? { ...previousItem.attrs, spread: true }
      : previousItem.attrs,
    newPreviousItemContent,
    previousItem.marks,
  );
  newPreviousItem.check();

  tr.replaceRangeWith(
    previousItemStart - 1,
    previousItemEnd + 1,
    newPreviousItem,
  );
  if (requiresLooseNesting) {
    const list = tr.doc.nodeAt(previousListStart);
    if (list) {
      tr.setNodeMarkup(previousListStart, undefined, {
        ...list.attrs,
        tight: list.childCount === 1,
      });
    }
  }

  tr.setSelection(
    previousList === selectedList
      ? TextSelection.between(tr.doc.resolve($from.pos), tr.doc.resolve($to.pos))
      : TextSelection.between(
          tr.doc.resolve($from.pos - 2),
          tr.doc.resolve($to.pos - 2),
        ),
  );

  return true;
}

function copyListForIndent(
  list: ProseMirrorNode,
  slice: Slice,
  startIndex: number,
) {
  const items: ProseMirrorNode[] = [];
  slice.content.forEach((item) => items.push(item));
  const tight = items.length === 1 ? true : list.attrs.tight;

  const attrs =
    list.type === gfmSchema.nodes.ordered_list
      ? {
          ...list.attrs,
          order: Number(list.attrs.order) + startIndex,
          tight,
        }
      : { ...list.attrs, tight };

  return list.type.createChecked(
    attrs,
    Fragment.fromArray(items),
  );
}

function findPreviousItem(
  selectedList: ProseMirrorNode,
  $from: ResolvedPos,
  range: NodeRange,
) {
  let previousItem: ProseMirrorNode;
  let previousList: ProseMirrorNode;
  let previousItemStart: number;
  let previousListStart: number;

  const doc = $from.doc;

  if (range.startIndex >= 1) {
    previousItem = selectedList.child(range.startIndex - 1);
    previousList = selectedList;
    previousListStart = $from.before(range.depth);
    previousItemStart = doc.resolve(range.start).start(range.depth) + 1;

    for (let i = 0; i < range.startIndex - 1; i += 1) {
      previousItemStart += previousList.child(i).nodeSize;
    }
  } else {
    const listIndex = $from.index(range.depth - 1);
    if (listIndex < 1) return false;

    const listParent = $from.node(range.depth - 1);
    const listParentStart = $from.start(range.depth - 1);
    previousList = listParent.child(listIndex - 1);
    if (!isListNode(previousList)) return false;

    previousListStart = listParentStart;
    for (let i = 0; i < listIndex - 1; i += 1) {
      previousListStart += listParent.child(i).nodeSize;
    }

    previousItem = previousList.child(previousList.childCount - 1);
    previousItemStart =
      previousListStart + previousList.nodeSize - previousItem.nodeSize;

    if (!isListItemNode(previousItem)) return false;
  }

  return {
    previousItem,
    previousList,
    previousItemStart,
    previousListStart,
  };
}

function dedentList(tr: Transaction) {
  let range = calculateItemRange(tr.selection);
  if (!range) return false;

  const parent = findParentItem(tr.selection.$from, range);
  if (!parent) return false;
  const parentItemPos = range.$from.before(range.depth - 1);

  range = indentSiblingsOfItems(tr, range);
  range = indentSiblingsOfList(tr, range);
  range = changeListType(tr, range, parent.parentList);

  const target = liftTarget(range);
  if (typeof target !== "number") return true;

  tr.lift(range, target);

  range = calculateItemRange(tr.selection);
  if (range) {
    maybeJoinList(tr, tr.doc.resolve(range.end - 2));
  }
  normalizeSingleBlockItemSpread(tr, tr.mapping.map(parentItemPos));

  return true;
}

function normalizeSingleBlockItemSpread(tr: Transaction, pos: number) {
  const item = tr.doc.nodeAt(pos);
  if (
    item &&
    isListItemNode(item) &&
    item.childCount === 1 &&
    item.attrs.spread
  ) {
    tr.setNodeMarkup(pos, undefined, { ...item.attrs, spread: false });
  }
}

function findParentItem($from: ResolvedPos, range: NodeRange) {
  const parentItem = $from.node(range.depth - 1);
  const parentList = $from.node(range.depth - 2);

  if (!isListItemNode(parentItem) || !isListNode(parentList)) return false;

  return { parentItem, parentList };
}

function indentSiblingsOfItems(tr: Transaction, range: NodeRange) {
  const selectedList = range.parent;
  const lastSelectedItem = range.parent.child(range.endIndex - 1);

  const endOfRange = range.end;
  const endOfSelectedList = range.$to.end(range.depth);

  if (endOfRange < endOfSelectedList) {
    tr.step(
      new ReplaceAroundStep(
        endOfRange - 1,
        endOfSelectedList,
        endOfRange,
        endOfSelectedList,
        new Slice(
          Fragment.from(lastSelectedItem.type.create(null, selectedList.copy())),
          1,
          0,
        ),
        1,
        true,
      ),
    );
    return new NodeRange(
      tr.doc.resolve(range.$from.pos),
      tr.doc.resolve(endOfSelectedList),
      range.depth,
    );
  }

  return range;
}

function indentSiblingsOfList(tr: Transaction, range: NodeRange) {
  const selectedList = range.parent;
  const lastSelectedItem = range.parent.child(range.endIndex - 1);

  const endOfSelectedList = range.end;
  const endOfParentListItem = range.$to.end(range.depth - 1);

  if (endOfSelectedList + 1 < endOfParentListItem) {
    tr.step(
      new ReplaceAroundStep(
        endOfSelectedList - 1,
        endOfParentListItem,
        endOfSelectedList + 1,
        endOfParentListItem,
        new Slice(
          Fragment.from(
            selectedList.type.create(null, lastSelectedItem.type.create(null)),
          ),
          2,
          0,
        ),
        0,
        true,
      ),
    );
    return new NodeRange(tr.selection.$from, tr.selection.$to, range.depth);
  }

  return range;
}

function changeListType(
  tr: Transaction,
  range: NodeRange,
  parentList: ProseMirrorNode,
) {
  const wrapped = wrapSelectedItems({
    listType: parentList.type,
    tr,
  });

  return wrapped
    ? new NodeRange(tr.selection.$from, tr.selection.$to, range.depth)
    : range;
}

function wrapSelectedItems({
  listType,
  tr,
}: {
  listType: ProseMirrorNode["type"];
  tr: Transaction;
}) {
  const range = calculateItemRange(tr.selection);
  if (!range) return false;

  const atStart = range.startIndex === 0;
  const { from, to } = tr.selection;

  if (!wrapItems({ listType, tr, range })) return false;

  tr.setSelection(
    TextSelection.between(
      tr.doc.resolve(atStart ? from : from + 2),
      tr.doc.resolve(atStart ? to : to + 2),
    ),
  );
  tr.scrollIntoView();

  return true;
}

function wrapItems({
  listType,
  tr,
  range,
}: {
  listType: ProseMirrorNode["type"];
  tr: Transaction;
  range: NodeRange;
}) {
  const oldList = range.parent;
  const slice = tr.doc.slice(range.start, range.end);

  if (oldList.type === listType) return false;

  const newList = listType.createChecked(null, slice.content);
  tr.replaceRange(
    range.start,
    range.end,
    new Slice(Fragment.from(newList), 0, 0),
  );
  return true;
}

function maybeJoinList(tr: Transaction, $pos?: ResolvedPos) {
  const $from = $pos || tr.selection.$from;
  let joinable: number[] = [];

  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const parent = $from.node(depth);

    let index = $from.index(depth);
    let before = parent.maybeChild(index - 1);
    let after = parent.maybeChild(index);
    if (before && after && before.type === after.type && isListNode(before)) {
      joinable.push($from.before(depth + 1));
    }

    index = $from.indexAfter(depth);
    before = parent.maybeChild(index - 1);
    after = parent.maybeChild(index);
    if (before && after && before.type === after.type && isListNode(before)) {
      joinable.push($from.after(depth + 1));
    }
  }

  joinable = [...new Set(joinable)].sort((a, b) => b - a);
  let updated = false;
  for (const pos of joinable) {
    if (canJoin(tr.doc, pos)) {
      tr.join(pos);
      updated = true;
    }
  }

  return updated;
}
