import type { Mark, Node as ProseMirrorNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

interface ColorCodeRange {
  color: string;
  from: number;
  mark: Mark;
  source: string;
  to: number;
}

export const githubColorPluginKey = new PluginKey<DecorationSet>(
  "githubColorSwatches",
);

export function createGitHubColorPlugin() {
  return new Plugin<DecorationSet>({
    key: githubColorPluginKey,
    state: {
      init: (_, state) => buildColorDecorations(state.doc),
      apply: (transaction, decorations) =>
        transaction.docChanged
          ? buildColorDecorations(transaction.doc)
          : decorations.map(transaction.mapping, transaction.doc),
    },
    props: {
      decorations: (state) => githubColorPluginKey.getState(state) ?? null,
    },
  });
}

export function githubColorDecorations(state: EditorState) {
  return githubColorPluginKey.getState(state) ?? DecorationSet.empty;
}

export function parseGitHubColor(source: string): string | null {
  if (/^#[\da-f]{6}$/i.test(source)) return source;

  const rgb = source.match(
    /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i,
  );
  if (rgb) {
    const channels = rgb.slice(1).map(Number);
    if (channels.every((channel) => channel <= 255)) {
      return `rgb(${channels.join(", ")})`;
    }
  }

  const hsl = source.match(
    /^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/i,
  );
  if (hsl) {
    const [hue, saturation, lightness] = hsl.slice(1).map(Number);
    if (hue <= 360 && saturation <= 100 && lightness <= 100) {
      return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }
  }

  return null;
}

function buildColorDecorations(doc: ProseMirrorNode) {
  const decorations = colorCodeRanges(doc).map((range) =>
    Decoration.widget(
      range.to,
      () => {
        const swatch = document.createElement("span");
        swatch.className = "gfmd-color-swatch";
        swatch.contentEditable = "false";
        swatch.dataset.color = range.source;
        swatch.dataset.gfmdColorSwatch = "";
        swatch.setAttribute("aria-label", `Color preview: ${range.source}`);
        swatch.setAttribute("role", "img");
        swatch.style.backgroundColor = range.color;
        swatch.title = `Color preview: ${range.source}`;
        return swatch;
      },
      {
        ignoreSelection: true,
        key: `${range.from}:${range.to}:${range.source}`,
        marks: [range.mark],
        side: -1,
      },
    ),
  );

  return DecorationSet.create(doc, decorations);
}

function colorCodeRanges(doc: ProseMirrorNode) {
  const ranges: ColorCodeRange[] = [];
  let pending:
    | {
        from: number;
        mark: Mark;
        source: string;
        to: number;
      }
    | undefined;

  const flush = () => {
    if (!pending) return;
    const color = parseGitHubColor(pending.source);
    if (color) ranges.push({ ...pending, color });
    pending = undefined;
  };

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return true;
    }

    const codeMark = node.marks.find((mark) => mark.type.name === "code");
    if (!codeMark) {
      flush();
      return true;
    }

    if (pending && pending.to === pos && pending.mark.eq(codeMark)) {
      pending.source += node.text;
      pending.to += node.nodeSize;
    } else {
      flush();
      pending = {
        from: pos,
        mark: codeMark,
        source: node.text,
        to: pos + node.nodeSize,
      };
    }

    return true;
  });
  flush();

  return ranges;
}
