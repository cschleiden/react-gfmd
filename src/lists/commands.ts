import type { Node as ProseMirrorNode, NodeType } from "prosemirror-model";
import { Fragment } from "prosemirror-model";
import { wrapInList } from "prosemirror-schema-list";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { gfmSchema } from "../schema";
import { changeListIndent } from "./indent";
import {
  currentListContainerContext,
  currentListItemContext,
  currentListItem,
  isInAnyListItem,
  selectedListItemPositions,
} from "./utils";

export { changeListIndent, isInAnyListItem };

export type CurrentListKind = "bullet" | "ordered" | "task";

export function changeListType(target: "bullet" | "ordered"): Command {
  const targetType =
    target === "ordered"
      ? gfmSchema.nodes.ordered_list
      : gfmSchema.nodes.bullet_list;
  const wrapCommand = wrapInList(targetType);

  return (state, dispatch, view) => {
    const context = currentListContainerContext(state);
    if (!context) {
      return wrapCommand(state, dispatch, view);
    }

    if (context.node.type === targetType) {
      return convertSelectedItemsToPlainListItems(state, dispatch);
    }
    if (!dispatch) return true;

    const attrs =
      target === "ordered"
        ? {
            order: Number(context.node.attrs.order ?? 1),
            tight: context.node.attrs.tight ?? true,
          }
        : {
            tight: context.node.attrs.tight ?? true,
          };

    dispatch(convertSelectedListItems(state, context, targetType, attrs));
    return true;
  };
}

function convertSelectedItemsToPlainListItems(
  state: EditorState,
  dispatch?: EditorView["dispatch"],
) {
  const positions = selectedListItemPositions(state);
  const taskPositions = positions.filter(
    (pos) => state.doc.nodeAt(pos)?.type === gfmSchema.nodes.task_list_item,
  );

  if (!taskPositions.length) return true;
  if (!dispatch) return true;

  let tr = state.tr;
  for (const pos of taskPositions) {
    const node = tr.doc.nodeAt(pos);
    if (!node || !gfmSchema.nodes.list_item.validContent(node.content)) continue;
    tr = tr.setNodeMarkup(pos, gfmSchema.nodes.list_item);
  }

  dispatch(tr);
  return true;
}

function convertSelectedListItems(
  state: EditorState,
  context: ReturnType<typeof currentListContainerContext>,
  targetType: NodeType,
  attrs: Record<string, unknown>,
) {
  if (!context) return state.tr;

  const tr = state.tr;
  const selectedPositions = new Set(selectedListItemPositions(state));
  const selectedItems: ProseMirrorNode[] = [];
  const beforeItems: ProseMirrorNode[] = [];
  const afterItems: ProseMirrorNode[] = [];
  let seenSelected = false;
  let childPos = context.pos + 1;

  for (let index = 0; index < context.node.childCount; index += 1) {
    const child = context.node.child(index);
    const isSelected = selectedPositions.has(childPos);

    if (isSelected) {
      seenSelected = true;
      selectedItems.push(asPlainListItem(child));
    } else if (seenSelected) {
      afterItems.push(child);
    } else {
      beforeItems.push(child);
    }

    childPos += child.nodeSize;
  }

  if (!selectedItems.length) return tr;

  const replacement: ProseMirrorNode[] = [
    copyListWithItems(context.node, beforeItems),
    targetType.create(attrs, selectedItems),
    copyListWithItems(context.node, afterItems),
  ].filter((node): node is ProseMirrorNode => Boolean(node));

  tr.replaceWith(
    context.pos,
    context.pos + context.node.nodeSize,
    Fragment.fromArray(replacement),
  );

  return tr;
}

function copyListWithItems(list: ProseMirrorNode, items: ProseMirrorNode[]) {
  return items.length ? list.copy(Fragment.fromArray(items)) : null;
}

function asPlainListItem(item: ProseMirrorNode) {
  if (item.type === gfmSchema.nodes.list_item) return item;
  return gfmSchema.nodes.list_item.createChecked(null, item.content);
}

export function isCurrentListType(type: NodeType) {
  return (state: EditorState) => {
    const kind = currentListKind(state);
    if (type === gfmSchema.nodes.bullet_list) return kind === "bullet";
    if (type === gfmSchema.nodes.ordered_list) return kind === "ordered";
    return false;
  };
}

export function currentListKind(state: EditorState): CurrentListKind | null {
  const itemContext = currentListItemContext(state);
  if (!itemContext) return null;

  if (
    itemContext.node.type === gfmSchema.nodes.task_list_item &&
    itemContext.node.attrs.checked !== null
  ) {
    return "task";
  }

  if (itemContext.parent.type === gfmSchema.nodes.bullet_list) return "bullet";
  if (itemContext.parent.type === gfmSchema.nodes.ordered_list) return "ordered";
  return null;
}

export function insertTaskList(
  state: EditorState,
  dispatch?: EditorView["dispatch"],
) {
  const listItems = selectedListItemPositions(state);
  if (listItems.length) {
    if (!dispatch) return true;
    let tr = state.tr;
    for (const pos of listItems) {
      const node = tr.doc.nodeAt(pos);
      if (node?.type === gfmSchema.nodes.list_item) {
        tr = tr.setNodeMarkup(pos, gfmSchema.nodes.task_list_item, {
          checked: false,
          spread: node.attrs.spread,
        });
      }
    }
    dispatch(tr.scrollIntoView());
    return true;
  }

  if (!dispatch) return true;

  const paragraphRange = selectedParagraphRange(state);
  if (paragraphRange) {
    const { node, from, to } = paragraphRange;
    const paragraph =
      node.content.size > 0
        ? gfmSchema.nodes.paragraph.create(null, node.content)
        : gfmSchema.nodes.paragraph.create(null, gfmSchema.text("Task item"));
    const task = createTaskList(paragraph);
    let tr = state.tr.replaceWith(from, to, task).scrollIntoView();
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(from + 3)));
    dispatch(tr);
    return true;
  }

  const label = state.selection.empty
    ? "Task item"
    : state.doc.textBetween(state.selection.from, state.selection.to);
  dispatch(
    state.tr
      .replaceSelectionWith(
        createTaskList(
          gfmSchema.nodes.paragraph.create(null, gfmSchema.text(label)),
        ),
      )
      .scrollIntoView(),
  );
  return true;
}

function createTaskList(
  paragraph: ReturnType<typeof gfmSchema.nodes.paragraph.create>,
) {
  return gfmSchema.nodes.bullet_list.create(null, [
    gfmSchema.nodes.task_list_item.create(
      { checked: false, spread: false },
      paragraph,
    ),
  ]);
}

function selectedParagraphRange(state: EditorState) {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== gfmSchema.nodes.paragraph)
    return undefined;

  return {
    node: $from.parent,
    from: $from.before(),
    to: $from.after(),
  };
}
