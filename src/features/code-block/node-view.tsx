import { Menu } from "@base-ui/react/menu";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import { createRoot, type Root } from "react-dom/client";

const supportedLanguages = [
  "text",
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "go",
  "graphql",
  "html",
  "java",
  "javascript",
  "json",
  "kotlin",
  "markdown",
  "php",
  "python",
  "ruby",
  "rust",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "xml",
  "yaml",
] as const;

export class CodeBlockNodeView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private header: HTMLElement;
  private root: Root;

  constructor(
    private node: ProseMirrorNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    this.dom = document.createElement("section");
    this.dom.className = "gfmd-code-block";
    this.dom.dataset.gfmdCodeBlock = "";

    this.header = document.createElement("div");
    this.header.className = "gfmd-code-block-header";
    this.root = createRoot(this.header);
    this.renderHeader();

    const pre = document.createElement("pre");
    pre.className = "gfmd-code-block-pre";
    this.contentDOM = document.createElement("code");
    this.contentDOM.className = "gfmd-code-block-content";
    pre.append(this.contentDOM);

    this.dom.append(this.header, pre);
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.renderHeader();
    return true;
  }

  destroy() {
    queueMicrotask(() => {
      this.root.unmount();
    });
  }

  private setLanguage = (language: string | null) => {
    const pos = this.getPos();
    if (typeof pos !== "number") return;

    this.view.dispatch(
      this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        language,
      }),
    );
    this.view.focus();
  };

  private renderHeader() {
    const currentLanguage =
      typeof this.node.attrs.language === "string"
        ? this.node.attrs.language
        : null;

    this.root.render(
      <CodeLanguageMenu
        currentLanguage={currentLanguage}
        onSelectLanguage={this.setLanguage}
      />,
    );
  }
}

function CodeLanguageMenu({
  currentLanguage,
  onSelectLanguage,
}: {
  currentLanguage: string | null;
  onSelectLanguage: (language: string | null) => void;
}) {
  const displayLanguage = currentLanguage ?? "text";
  const hasCustomLanguage =
    !!currentLanguage &&
    !supportedLanguages.includes(
      currentLanguage as (typeof supportedLanguages)[number],
    );
  const languages = hasCustomLanguage
    ? [displayLanguage, ...supportedLanguages]
    : [...supportedLanguages];

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className="gfmd-code-block-language"
        type="button"
        aria-label="Code language"
      >
        {labelForLanguage(displayLanguage)}
        <span className="gfmd-code-block-language-icon" aria-hidden>
          ▾
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4}>
          <Menu.Popup className="gfmd-code-block-language-menu">
            {languages.map((language) => {
              const selected = displayLanguage === language;
              return (
                <Menu.Item
                  className="gfmd-code-block-language-item"
                  data-selected={selected ? "" : undefined}
                  key={language}
                  onClick={() =>
                    onSelectLanguage(language === "text" ? null : language)
                  }
                >
                  {labelForLanguage(language)}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function labelForLanguage(language: string) {
  if (language === "text") return "Plain text";
  if (language === "cpp") return "C++";
  if (language === "csharp") return "C#";
  if (language === "tsx") return "TSX";
  if (language === "javascript") return "JavaScript";
  if (language === "typescript") return "TypeScript";
  return language.charAt(0).toUpperCase() + language.slice(1);
}
