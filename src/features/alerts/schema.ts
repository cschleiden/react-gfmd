import type { NodeSpec } from "prosemirror-model";
import { alertLabel, isAlertKind, type AlertKind } from "./model";

export const alertNodeSpec: NodeSpec = {
  attrs: {
    kind: { default: "note" },
  },
  content: "block+",
  group: "block",
  defining: true,
  parseDOM: [
    {
      tag: "div[data-gfmd-alert]",
      getAttrs: alertAttrsFromDOM,
      contentElement: (node) =>
        node instanceof HTMLElement
          ? (node.querySelector("[data-gfmd-alert-content]") ?? node)
          : node,
    },
    {
      tag: "div.markdown-alert",
      getAttrs: alertAttrsFromDOM,
      contentElement: githubAlertContent,
    },
  ],
  toDOM: (node) => {
    const kind = normalizedAlertKind(node.attrs.kind);
    const label = alertLabel(kind);

    return [
      "div",
      {
        class: `gfmd-alert gfmd-alert-${kind}`,
        "data-gfmd-alert": "",
        "data-alert-kind": kind,
        role: "note",
      },
      [
        "p",
        {
          class: "gfmd-alert-title",
          contenteditable: "false",
        },
        [
          "span",
          {
            "aria-hidden": "true",
            class: "gfmd-alert-icon",
          },
        ],
        label,
      ],
      ["div", { class: "gfmd-alert-content", "data-gfmd-alert-content": "" }, 0],
    ];
  },
};

function alertAttrsFromDOM(node: Node | string) {
  if (!(node instanceof HTMLElement)) return false;

  const dataKind = node.getAttribute("data-alert-kind");
  if (isAlertKind(dataKind)) return { kind: dataKind.toLowerCase() };

  const classKind = [...node.classList]
    .find((className) => className.startsWith("markdown-alert-"))
    ?.slice("markdown-alert-".length);
  return isAlertKind(classKind)
    ? { kind: classKind.toLowerCase() }
    : false;
}

function githubAlertContent(node: HTMLElement) {
  const content = document.createElement("div");
  for (const child of node.childNodes) {
    if (
      child instanceof HTMLElement &&
      child.classList.contains("markdown-alert-title")
    ) {
      continue;
    }
    content.append(child.cloneNode(true));
  }
  return content;
}

function normalizedAlertKind(value: unknown): AlertKind {
  return isAlertKind(value) ? value.toLowerCase() as AlertKind : "note";
}
