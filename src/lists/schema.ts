import type { NodeSpec } from "prosemirror-model";

export const orderedListNodeSpec: NodeSpec = {
  content: "(list_item | task_list_item)+",
  group: "block",
  attrs: {
    order: { default: 1 },
    tight: { default: true },
  },
  parseDOM: [
    {
      tag: "ol",
      getAttrs: (node) => {
        if (!(node instanceof HTMLElement)) return false;
        return {
          order: node.hasAttribute("start")
            ? Number(node.getAttribute("start"))
            : 1,
        };
      },
    },
  ],
  toDOM: (node) =>
    node.attrs.order === 1 ? ["ol", 0] : ["ol", { start: node.attrs.order }, 0],
};

export const bulletListNodeSpec: NodeSpec = {
  content: "(list_item | task_list_item)+",
  group: "block",
  attrs: {
    tight: { default: true },
  },
  parseDOM: [{ tag: "ul" }],
  toDOM: () => ["ul", 0],
};

export const listItemNodeSpec: NodeSpec = {
  content: "paragraph block*",
  defining: true,
  attrs: {
    spread: { default: false },
  },
  parseDOM: [
    {
      tag: "li",
      getAttrs: (node) => {
        if (!(node instanceof HTMLElement)) return false;
        return { spread: node.getAttribute("data-spread") === "true" };
      },
    },
  ],
  toDOM: (node) => [
    "li",
    { "data-spread": node.attrs.spread ? "true" : "false" },
    0,
  ],
};

export const taskListItemNodeSpec: NodeSpec = {
  ...listItemNodeSpec,
  attrs: {
    checked: { default: false },
    spread: { default: false },
  },
  parseDOM: [
    {
      tag: "li[data-gfmd-task-item], li[data-checked]",
      getAttrs: (node) => {
        if (!(node instanceof HTMLElement)) return false;

        const checkedAttr = node.getAttribute("data-checked");
        const spread = node.getAttribute("data-spread") === "true";
        if (checkedAttr === "true") return { checked: true, spread };
        if (checkedAttr === "false") return { checked: false, spread };
        if (checkedAttr === "") return { checked: null, spread };

        const checkbox = node.querySelector("input[type='checkbox']");
        if (checkbox instanceof HTMLInputElement) {
          return { checked: checkbox.checked, spread };
        }

        return false;
      },
    },
  ],
  toDOM: (node) => {
    const checked = node.attrs.checked;
    const attrs = {
      "data-gfmd-task-item": "",
      "data-checked": checked === null ? "" : String(checked),
      "data-spread": node.attrs.spread ? "true" : "false",
      class:
        checked === null
          ? "gfmd-task-list-item-plain"
          : "gfmd-task-list-item",
    };

    if (checked === null) {
      return ["li", attrs, 0];
    }

    return [
      "li",
      attrs,
      [
        "input",
        {
          type: "checkbox",
          class: "gfmd-task-checkbox",
          "data-gfmd-task-checkbox": "",
          contenteditable: "false",
          checked,
          readOnly: true,
          "aria-label": checked ? "Mark task incomplete" : "Mark task complete",
        },
      ],
      ["div", { class: "gfmd-list-item-content" }, 0],
    ];
  },
};
