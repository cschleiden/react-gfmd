import { Plugin } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { gfmSchema } from "../schema";

export function createTaskListPlugin() {
  return new Plugin({
    view(view) {
      const handleEvent = (event: Event) => {
        handleTaskCheckboxClick(view, event);
      };

      view.dom.addEventListener("click", handleEvent);

      return {
        destroy() {
          view.dom.removeEventListener("click", handleEvent);
        },
      };
    },
  });
}

function handleTaskCheckboxClick(view: EditorView, event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return false;
  const input = event.target;
  if (!input.classList.contains("gfmd-task-checkbox")) return false;
  event.preventDefault();

  let pos: number;
  try {
    pos = view.posAtDOM(input, 0);
  } catch {
    return false;
  }

  const $pos = view.state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type !== gfmSchema.nodes.task_list_item) continue;

    const nodePos = $pos.before(depth);
    const node = view.state.doc.nodeAt(nodePos);
    if (!node || node.type !== gfmSchema.nodes.task_list_item) return false;
    if (node.attrs.checked === null) return true;

    return setTaskChecked(view, nodePos, !node.attrs.checked);
  }

  return false;
}

function setTaskChecked(view: EditorView, pos: number, checked: boolean) {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type !== gfmSchema.nodes.task_list_item) {
    return false;
  }

  if (node.attrs.checked === checked) return true;

  view.dispatch(
    view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      checked,
    }),
  );

  return true;
}
