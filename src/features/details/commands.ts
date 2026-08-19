import {
  Fragment,
  type Node as ProseMirrorNode,
  type ResolvedPos,
} from "prosemirror-model";
import {
  AllSelection,
  NodeSelection,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { isListItemType } from "../../lists/utils";
import { gfmSchema } from "../../schema";
import { defaultDetailsSummary } from "./model";
import {
  hasDetailsInsertionForbiddenAncestor,
  hasEmptyLeadingListParagraph,
  insertDetailsWithoutDeletingSelection,
  insertedDetailsPosition,
  introducesUnexpectedEmptyTextblocks,
  isDetailsInsertionForbiddenNode,
  loosenDetailsListAncestors,
} from "./transactions";

export const insertDetails: Command = (state, dispatch) => {
  const insertion = detailsInsertion(state);
  if (!insertion) return false;
  if (dispatch) dispatch(insertion.scrollIntoView());
  return true;
};

function detailsInsertion(state: EditorState) {
  if (
    (state.selection instanceof NodeSelection &&
      isDetailsInsertionForbiddenNode(state.selection.node)) ||
    hasDetailsInsertionForbiddenAncestor(state.selection.$from) ||
    hasDetailsInsertionForbiddenAncestor(state.selection.$to)
  ) {
    return null;
  }

  const selectedBody = selectionHasSameOwnership(state)
    ? movableSelectionContent(state)
    : null;
  if (selectedBody) {
    const details = createDetails(selectedBody);
    if (details) {
      const transaction = state.tr.replaceSelectionWith(details, false);
      const detailsPos = insertedDetailsPosition(transaction, details);
      if (
        detailsPos !== null &&
        detailsBody(transaction.doc.nodeAt(detailsPos)).eq(selectedBody) &&
        !hasEmptyLeadingListParagraph(transaction.doc, detailsPos) &&
        !introducesUnexpectedEmptyTextblocks(transaction, details)
      ) {
        loosenDetailsListAncestors(transaction, detailsPos);
        return selectMovedBody(
          transaction,
          detailsPos,
          details,
          state.selection,
        );
      }
    }
  }

  const details = createDetails(defaultBody());
  if (!details) return null;

  let transaction = state.selection.empty
    ? state.tr.replaceSelectionWith(details, false)
    : insertDetailsWithoutDeletingSelection(state, details);
  if (!transaction.docChanged) return null;
  let detailsPos = insertedDetailsPosition(transaction, details);
  if (
    detailsPos !== null &&
    hasEmptyLeadingListParagraph(transaction.doc, detailsPos)
  ) {
    transaction = insertDetailsWithoutDeletingSelection(state, details);
    detailsPos = insertedDetailsPosition(transaction, details);
  }
  if (
    detailsPos === null ||
    hasEmptyLeadingListParagraph(transaction.doc, detailsPos)
  ) {
    return null;
  }

  loosenDetailsListAncestors(transaction, detailsPos);
  return selectSummary(transaction, detailsPos);
}

function movableSelectionContent(state: EditorState) {
  const { selection } = state;
  if (
    selection.empty ||
    !(
      selection instanceof TextSelection ||
      selection instanceof NodeSelection ||
      selection instanceof AllSelection
    )
  ) {
    return null;
  }

  let { content, openStart, openEnd } = selection.content();
  while (openStart > 1 && openEnd > 1 && content.childCount === 1) {
    const parent = content.firstChild;
    if (!parent) break;
    content = parent.content;
    openStart -= 1;
    openEnd -= 1;
  }
  if (hasEmptyTextblock(content)) return null;
  return createDetails(content) ? content : null;
}

function createDetails(body: Fragment) {
  const summary = gfmSchema.nodes.details_summary.create(
    null,
    gfmSchema.text(defaultDetailsSummary),
  );
  const content = Fragment.from(summary).append(body);
  if (!gfmSchema.nodes.details.validContent(content)) return null;

  return gfmSchema.nodes.details.create(
    { open: false, implicitSummary: false },
    content,
  );
}

function defaultBody() {
  return Fragment.from(gfmSchema.nodes.paragraph.create());
}

function detailsBody(node: ProseMirrorNode | null) {
  if (node?.type !== gfmSchema.nodes.details || !node.firstChild) {
    return Fragment.empty;
  }
  return node.content.cut(node.firstChild.nodeSize);
}

function selectSummary(transaction: Transaction, detailsPos: number) {
  const from = detailsPos + 2;
  return transaction.setSelection(
    TextSelection.create(
      transaction.doc,
      from,
      from + defaultDetailsSummary.length,
    ),
  );
}

function selectMovedBody(
  transaction: Transaction,
  detailsPos: number,
  details: ProseMirrorNode,
  originalSelection: Selection,
) {
  const summary = details.firstChild;
  if (!summary) return selectSummary(transaction, detailsPos);

  const bodyStart = detailsPos + 1 + summary.nodeSize;
  if (originalSelection instanceof NodeSelection) {
    return transaction.setSelection(
      NodeSelection.create(transaction.doc, bodyStart),
    );
  }

  const bodyEnd = bodyStart + detailsBody(details).size;
  const startSelection = Selection.findFrom(
    transaction.doc.resolve(bodyStart),
    1,
    true,
  );
  const endSelection = Selection.findFrom(
    transaction.doc.resolve(bodyEnd),
    -1,
    true,
  );
  if (!startSelection || !endSelection) {
    return transaction.setSelection(
      NodeSelection.create(transaction.doc, bodyStart),
    );
  }

  return transaction.setSelection(
    TextSelection.between(startSelection.$from, endSelection.$to),
  );
}

function selectionHasSameOwnership(state: EditorState) {
  const fromPath = ownershipPath(state.selection.$from);
  const toPath = ownershipPath(state.selection.$to);
  return (
    fromPath.length === toPath.length &&
    fromPath.every((entry, index) => entry === toPath[index])
  );
}

function ownershipPath($position: ResolvedPos) {
  const path: string[] = [];
  for (let depth = 1; depth <= $position.depth; depth += 1) {
    const node = $position.node(depth);
    if (!isOwnershipContainer(node)) continue;
    path.push(`${node.type.name}:${$position.before(depth)}`);
  }
  return path;
}

function isOwnershipContainer(node: ProseMirrorNode) {
  return (
    isListItemType(node.type) ||
    node.type === gfmSchema.nodes.blockquote ||
    node.type === gfmSchema.nodes.alert ||
    node.type === gfmSchema.nodes.details ||
    node.type === gfmSchema.nodes.footnote_definition ||
    node.type === gfmSchema.nodes.html_block_container ||
    node.type === gfmSchema.nodes.definition_description
  );
}

function hasEmptyTextblock(fragment: Fragment) {
  let found = false;
  fragment.forEach((node) => {
    if (node.isTextblock && node.content.size === 0) found = true;
    node.descendants((descendant) => {
      if (descendant.isTextblock && descendant.content.size === 0) {
        found = true;
      }
    });
  });
  return found;
}
