import type {
  Node as ProseMirrorNode,
  ResolvedPos,
  Slice,
} from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";
import { isListItemType, isListType } from "../../lists/utils";
import { gfmSchema } from "../../schema";

export function standaloneDetailsNode(slice: Slice) {
  if (slice.content.childCount !== 1) return null;
  const details = slice.content.firstChild;
  if (
    details?.type !== gfmSchema.nodes.details ||
    details.firstChild?.type !== gfmSchema.nodes.details_summary
  ) {
    return null;
  }
  return details;
}

export function hasDetailsInsertionForbiddenAncestor($position: ResolvedPos) {
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    if (isDetailsInsertionForbiddenNode($position.node(depth))) {
      return true;
    }
  }
  return false;
}

export function isDetailsInsertionForbiddenNode(node: ProseMirrorNode) {
  return (
    node.type === gfmSchema.nodes.details_summary ||
    node.type === gfmSchema.nodes.definition_term ||
    node.type === gfmSchema.nodes.table_cell ||
    node.type === gfmSchema.nodes.table_header
  );
}

export function insertedDetailsPosition(
  transaction: Transaction,
  expected: ProseMirrorNode,
) {
  const expectedPosition = transaction.mapping.map(
    transaction.before.content.findDiffStart(transaction.doc.content) ?? 0,
    -1,
  );
  let closestPosition: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  transaction.doc.descendants((node, pos) => {
    if (node.type !== gfmSchema.nodes.details || !node.eq(expected)) return;

    const distance = Math.abs(pos - expectedPosition);
    if (distance < closestDistance) {
      closestPosition = pos;
      closestDistance = distance;
    }
    return false;
  });

  return closestPosition;
}

export function insertDetailsWithoutDeletingSelection(
  state: EditorState,
  details: ProseMirrorNode,
) {
  const { $from } = state.selection;
  let preferAfter = false;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const parent = $from.node(depth - 1);
    const index = $from.index(depth - 1);
    if (
      isListItemType(parent.type) &&
      parent.firstChild?.type === gfmSchema.nodes.paragraph &&
      parent.firstChild.content.size === 0
    ) {
      preferAfter = true;
      continue;
    }
    if (
      preferAfter &&
      parent.canReplaceWith(index + 1, index + 1, details.type)
    ) {
      const pos = $from.after(depth);
      return state.tr.replaceRangeWith(pos, pos, details);
    }
    if (parent.canReplaceWith(index, index, details.type)) {
      const pos = $from.before(depth);
      return state.tr.replaceRangeWith(pos, pos, details);
    }
    if (parent.canReplaceWith(index + 1, index + 1, details.type)) {
      const pos = $from.after(depth);
      return state.tr.replaceRangeWith(pos, pos, details);
    }
  }

  return state.tr;
}

export function hasEmptyLeadingListParagraph(
  doc: ProseMirrorNode,
  detailsPos: number,
) {
  const $details = doc.resolve(detailsPos + 1);
  for (let depth = $details.depth; depth > 0; depth -= 1) {
    const node = $details.node(depth);
    if (!isListItemType(node.type)) continue;
    return (
      node.firstChild?.type === gfmSchema.nodes.paragraph &&
      node.firstChild.content.size === 0
    );
  }
  return false;
}

export function introducesUnexpectedEmptyTextblocks(
  transaction: Transaction,
  inserted: ProseMirrorNode,
) {
  return (
    countEmptyTextblocks(transaction.doc) >
    countEmptyTextblocks(transaction.before) + countEmptyTextblocks(inserted)
  );
}

export function loosenDetailsListAncestors(
  transaction: Transaction,
  detailsPos: number,
) {
  const $details = transaction.doc.resolve(detailsPos + 1);
  const itemPositions: number[] = [];
  const listPositions: number[] = [];

  for (let depth = $details.depth; depth > 0; depth -= 1) {
    const type = $details.node(depth).type;
    if (isListItemType(type)) {
      itemPositions.push($details.before(depth));
    } else if (isListType(type)) {
      listPositions.push($details.before(depth));
    }
  }

  for (const itemPos of itemPositions) {
    const item = transaction.doc.nodeAt(itemPos);
    if (item && !item.attrs.spread) {
      transaction.setNodeMarkup(itemPos, undefined, {
        ...item.attrs,
        spread: true,
      });
    }
  }

  for (const listPos of listPositions) {
    const list = transaction.doc.nodeAt(listPos);
    const tight = list?.childCount === 1;
    if (list && list.attrs.tight !== tight) {
      transaction.setNodeMarkup(listPos, undefined, {
        ...list.attrs,
        tight,
      });
    }
  }
}

function countEmptyTextblocks(node: ProseMirrorNode) {
  let count = node.isTextblock && node.content.size === 0 ? 1 : 0;
  node.descendants((descendant) => {
    if (descendant.isTextblock && descendant.content.size === 0) count += 1;
  });
  return count;
}
