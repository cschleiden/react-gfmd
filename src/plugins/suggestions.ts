import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { CreateGFMarkdownStateOptions } from "../editor-types";
import { gfmSchema } from "../schema";
import type {
  MentionSuggestionProvider,
  ReferenceSuggestionProvider,
  ReferenceToken,
} from "../types";

const suggestionPluginKey = new PluginKey("gfmd-suggestions");

export function createSuggestionPlugin(options: CreateGFMarkdownStateOptions) {
  let controller: SuggestionController | undefined;

  return new Plugin({
    key: suggestionPluginKey,
    view(view) {
      controller = new SuggestionController(view, options);
      return controller;
    },
    props: {
      handleKeyDown(_, event) {
        return controller?.handleKeyDown(event) ?? false;
      },
      handleDOMEvents: {
        keyup(view) {
          void controller?.update(view);
          return false;
        },
        blur() {
          controller?.close();
          return false;
        },
      },
    },
  });
}

type SuggestionItem =
  | { kind: "reference"; label: string; detail?: string; ref: ReferenceToken }
  | { kind: "mention"; label: string; detail?: string; username: string };

class SuggestionController {
  private popup: HTMLDivElement;
  private items: SuggestionItem[] = [];
  private activeIndex = 0;
  private range: { from: number; to: number } | undefined;
  private requestId = 0;

  constructor(
    private view: EditorView,
    private options: CreateGFMarkdownStateOptions,
  ) {
    this.popup = document.createElement("div");
    this.popup.className = "gfmd-suggestions";
    this.popup.hidden = true;
    document.body.append(this.popup);
  }

  update(view = this.view) {
    this.view = view;
    const query = getSuggestionQuery(view);
    if (!query) {
      this.close();
      return;
    }

    this.range = query.range;
    this.positionPopup();
    this.renderLoading();
    const requestId = ++this.requestId;

    const provider =
      query.kind === "mention" ? this.options.mentionSuggestionProvider : this.options.referenceSuggestionProvider;
    const search =
      query.kind === "mention"
        ? (provider as MentionSuggestionProvider | undefined)?.searchMentions(query.text, this.options.context)
        : (provider as ReferenceSuggestionProvider | undefined)?.searchReferences(query.text, this.options.context);

    void Promise.resolve(search ?? []).then(
      (results) => {
        if (requestId !== this.requestId) return;
        this.items =
          query.kind === "mention"
            ? (results as Awaited<ReturnType<MentionSuggestionProvider["searchMentions"]>>).map((item) => ({
                kind: "mention",
                label: item.label,
                detail: item.detail,
                username: item.username,
              }))
            : (results as Awaited<ReturnType<ReferenceSuggestionProvider["searchReferences"]>>).map((item) => ({
                kind: "reference",
                label: item.label,
                detail: item.detail,
                ref: item.ref,
              }));
        this.activeIndex = 0;
        this.renderItems();
      },
      () => {
        if (requestId !== this.requestId) return;
        this.renderMessage("Could not load suggestions");
      },
    );
  }

  handleKeyDown(event: KeyboardEvent) {
    if (this.popup.hidden) return false;
    if (event.key === "Escape") {
      this.close();
      return true;
    }
    if (event.key === "ArrowDown") {
      this.activeIndex = Math.min(this.items.length - 1, this.activeIndex + 1);
      this.renderItems();
      return true;
    }
    if (event.key === "ArrowUp") {
      this.activeIndex = Math.max(0, this.activeIndex - 1);
      this.renderItems();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const item = this.items[this.activeIndex];
      if (!item || !this.range) return false;
      insertSuggestion(this.view, this.range, item);
      this.close();
      return true;
    }
    return false;
  }

  close() {
    this.popup.hidden = true;
    this.items = [];
    this.range = undefined;
  }

  destroy() {
    this.popup.remove();
  }

  private renderLoading() {
    this.popup.hidden = false;
    this.popup.textContent = "Loading...";
  }

  private renderMessage(message: string) {
    this.popup.hidden = false;
    this.popup.textContent = message;
  }

  private renderItems() {
    this.popup.hidden = false;
    this.popup.textContent = "";

    if (!this.items.length) {
      this.renderMessage("No suggestions");
      return;
    }

    this.items.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === this.activeIndex ? "is-active" : "";
      button.innerHTML = `<span>${escapeHtml(item.label)}</span>${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ""}`;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        if (!this.range) return;
        insertSuggestion(this.view, this.range, item);
        this.close();
      });
      this.popup.append(button);
    });
  }

  private positionPopup() {
    if (!this.range) return;
    const coords = this.view.coordsAtPos(this.range.to);
    this.popup.style.left = `${coords.left}px`;
    this.popup.style.top = `${coords.bottom + 6}px`;
  }
}

function getSuggestionQuery(view: EditorView) {
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return undefined;
  const { $from } = selection;
  const text = $from.parent.textBetween(0, $from.parentOffset, "\0", "\0");
  const match = text.match(/(?:^|\s)(@[\w-]{1,39}|(?:#|GH-)?\d{1,8}|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d{1,8})$/);
  if (!match) return undefined;
  const query = match[1];
  return {
    kind: query.startsWith("@") ? ("mention" as const) : ("reference" as const),
    text: query,
    range: {
      from: selection.from - query.length,
      to: selection.from,
    },
  };
}

function insertSuggestion(view: EditorView, range: { from: number; to: number }, item: SuggestionItem) {
  const node =
    item.kind === "mention"
      ? gfmSchema.nodes.mention.create({ username: item.username })
      : gfmSchema.nodes.reference.create(item.ref);
  view.dispatch(view.state.tr.replaceWith(range.from, range.to, node).insertText(" ", range.from + node.nodeSize));
  view.focus();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
