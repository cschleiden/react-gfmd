import { InputRule, wrappingInputRule } from "@handlewithcare/prosemirror-inputrules";
import type { ResolvedPos } from "prosemirror-model";
import { wrapInList } from "prosemirror-schema-list";
import { TextSelection, type Transaction } from "prosemirror-state";
import { gfmSchema } from "../schema";

export function createListInputRules() {
  return [
    delayedBulletListInputRule(),
    wrappingInputRule(/^(\d+)\.\s$/, gfmSchema.nodes.ordered_list, (match) => ({
      order: Number(match[1]),
    })),
    taskListShortcutInputRule(),
  ];
}

function taskListShortcutInputRule() {
  return new InputRule(/^\[\s\]\s$/, (state, _match, start, end) => {
    const { $from } = state.selection;

    let listItemDepth: number | null = null;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      if ($from.node(depth).type === gfmSchema.nodes.list_item) {
        listItemDepth = depth;
        break;
      }
    }

    if (listItemDepth === null) return null;

    const listItemPos = $from.before(listItemDepth);
    const spread = $from.node(listItemDepth).attrs.spread ?? false;

    return state.tr
      .setNodeMarkup(listItemPos, gfmSchema.nodes.task_list_item, {
        checked: false,
        spread,
      })
      .delete(start, end);
  });
}

function delayedBulletListInputRule() {
  return new InputRule(/^([-+*])\s(.+)$/, (state, match, start, end) => {
    const content = match[2];
    if (isPotentialTaskMarker(content)) return null;

    const taskMatch = content.match(/^\[([ xX])\]$/);
    const checked = taskMatch ? taskMatch[1].toLowerCase() === "x" : null;
    const itemText = checked === null ? content : "";
    const tr = state.tr.delete(start, end);
    if (itemText) {
      tr.insertText(itemText, start);
    }

    const intermediateState = state.apply(tr);
    let listTransaction: Transaction | null = null;
    const wrapped = wrapInList(gfmSchema.nodes.bullet_list)(
      intermediateState,
      (transaction) => {
        listTransaction = transaction;
      },
      undefined,
    );
    if (!wrapped || !listTransaction) return null;

    appendTransactionSteps(tr, listTransaction);

    if (checked !== null) {
      const listItemPos = findAncestorNodePosition(
        tr.selection.$from,
        gfmSchema.nodes.list_item.name,
      );
      if (listItemPos === null) return null;

      tr.setNodeMarkup(listItemPos, gfmSchema.nodes.task_list_item, {
        checked,
      });
    }

    return tr;
  });
}

function isPotentialTaskMarker(content: string) {
  return content === "[" || content === "[ " || /^\[[xX]$/.test(content);
}

function appendTransactionSteps(target: Transaction, source: Transaction) {
  for (const step of source.steps) {
    target.step(step);
  }

  target.setSelection(
    TextSelection.near(target.doc.resolve(source.selection.from)),
  );
}

function findAncestorNodePosition($pos: ResolvedPos, nodeName: string) {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === nodeName) return $pos.before(depth);
  }

  return null;
}
