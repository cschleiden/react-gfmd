import { closeHistory } from "prosemirror-history";
import type { Command, Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

interface HistoryActionOptions {
  focus?: boolean;
}

export function runIsolatedCommand(
  view: EditorView,
  command: Command,
  options: HistoryActionOptions = {},
) {
  view.dispatch(closeHistory(view.state.tr));
  const handled = command(view.state, view.dispatch, view);
  view.dispatch(closeHistory(view.state.tr));
  if (options.focus !== false) view.focus();
  return handled;
}

export function dispatchIsolatedTransaction(
  view: EditorView,
  transaction: Transaction,
  options: HistoryActionOptions = {},
) {
  view.dispatch(closeHistory(transaction));
  view.dispatch(closeHistory(view.state.tr));
  if (options.focus !== false) view.focus();
}
