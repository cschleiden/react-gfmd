import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createGFMarkdownState,
  GFMarkdownEditor,
  parseHTML,
  serializeMarkdown,
} from "../src";
import {
  githubColorDecorations,
  parseGitHubColor,
} from "../src/features/colors";

const context = { owner: "cschleiden", repo: "react-gfmd" };

describe("GitHub color previews", () => {
  it.each([
    ["#0969DA", "#0969DA"],
    ["rgb(9, 105, 218)", "rgb(9, 105, 218)"],
    ["RGB(9,105,218)", "rgb(9, 105, 218)"],
    ["hsl(212, 92%, 45%)", "hsl(212, 92%, 45%)"],
  ])("recognizes %s", (source, expected) => {
    expect(parseGitHubColor(source)).toBe(expected);
  });

  it.each([
    "#fff",
    "#0969DAff",
    "red",
    "rgba(9, 105, 218, 0.5)",
    "rgb(256, 0, 0)",
    "hsl(361, 50%, 50%)",
    "hsl(0, 101%, 50%)",
  ])("does not recognize unsupported color %s", (source) => {
    expect(parseGitHubColor(source)).toBeNull();
  });

  it("renders accessible swatches without changing inline-code source", () => {
    const markdown =
      "Colors `#0969DA`, `rgb(9, 105, 218)`, and `hsl(212, 92%, 45%)`.";

    render(
      <GFMarkdownEditor context={context} toolbar={false} value={markdown} />,
    );

    expect(
      screen.getByRole("img", { name: "Color preview: #0969DA" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "Color preview: rgb(9, 105, 218)",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: "Color preview: hsl(212, 92%, 45%)",
      }),
    ).toBeTruthy();
    expect(
      serializeMarkdown(createGFMarkdownState({ context, value: markdown }).doc),
    ).toBe(markdown);
  });

  it("updates previews as an inline color is edited", () => {
    let state = createGFMarkdownState({ context, value: "`#0969DA`" });
    const colorStart = findTextPosition(state.doc, "#0969DA");

    expect(githubColorDecorations(state).find()).toHaveLength(1);

    state = state.apply(state.tr.insertText("F", colorStart + "#0969DA".length));
    expect(githubColorDecorations(state).find()).toHaveLength(0);

    state = state.apply(
      state.tr.delete(
        colorStart + "#0969DA".length,
        colorStart + "#0969DA".length + 1,
      ),
    );
    expect(githubColorDecorations(state).find()).toHaveLength(1);
  });

  it("ignores unsupported colors and fenced code blocks", () => {
    render(
      <GFMarkdownEditor
        context={context}
        toolbar={false}
        value={"`#fff` and `red`\n\n```\n#0969DA\n```"}
      />,
    );

    expect(screen.queryAllByRole("img", { name: /Color preview:/ })).toHaveLength(
      0,
    );
  });

  it("drops GitHub's rendered swatch when parsing clipboard HTML", () => {
    const doc = parseHTML(
      '<p>Color <code>#0969DA<span class="ml-1 d-inline-block border circle" style="background-color: #0969DA; height: 8px; width: 8px;"></span></code>.</p>',
    );

    expect(serializeMarkdown(doc)).toBe("Color `#0969DA`.");
  });
});

function findTextPosition(doc: ReturnType<typeof parseHTML>, text: string) {
  let found = -1;
  doc.descendants((node, pos) => {
    if (node.isText && node.text === text) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}
