/// <reference types="vite/client" />

import { render } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { formatMarkdownPreview, initialMarkdown } from "../demo/main";
import { GFMarkdownEditor } from "../src";
import githubRenderedHtml from "./fixtures/demo.github.html?raw";

const context = { owner: "cschleiden", repo: "react-gfmd" };

describe("demo rendering", () => {
  it("shows serialized trailing spaces as whitespace instead of entities", () => {
    expect(formatMarkdownPreview("df&#x20;")).toBe("df ");
  });

  it("matches the semantic structure captured from GitHub's Markdown endpoint", async () => {
    const github = document.createElement("main");
    github.innerHTML = githubRenderedHtml;

    render(
      <GFMarkdownEditor
        context={context}
        toolbar={false}
        value={initialMarkdown}
      />,
    );
    await act(async () => {});
    const editor = document.querySelector<HTMLElement>(".gfmd-editor-surface");
    expect(editor).not.toBeNull();

    expect(renderingFingerprint(editor!)).toEqual(renderingFingerprint(github));
  });
});

function renderingFingerprint(root: HTMLElement) {
  const comparable = root.cloneNode(true) as HTMLElement;
  materializePreservedHtml(comparable);
  normalizeGitHubRendering(comparable);

  return {
    headings: elements(comparable, "h1,h2,h3,h4,h5,h6")
      .filter((heading) => !heading.closest("[data-footnotes]"))
      .map((heading) => [heading.tagName, text(heading)]),
    links: elements<HTMLAnchorElement>(comparable, "a[href]")
      .filter(
        (link) =>
          !link.hasAttribute("data-footnote-ref") &&
          !link.hasAttribute("data-footnote-backref") &&
          !link.hasAttribute("data-gfmd-reference") &&
          !link.classList.contains("user-mention") &&
          !link.querySelector("img"),
      )
      .map((link) => link.getAttribute("href")),
    lists: elements<HTMLOListElement | HTMLUListElement>(
      comparable,
      "ol, ul",
    )
      .filter(
        (list) =>
          !list.parentElement?.closest("ol, ul") &&
          !list.closest("[data-footnotes]"),
      )
      .map(listFingerprint),
    blockquotes: elements(comparable, "blockquote").map(text),
    alerts: elements<HTMLElement>(
      comparable,
      "[data-gfmd-alert], .markdown-alert",
    ).map(alertFingerprint),
    strongText: elements(comparable, "strong").map(text),
    table: elements(comparable, "table tr").map((row) =>
      elements(row, ":scope > th, :scope > td").map(text),
    ),
    codeBlocks: elements(comparable, "pre:not([data-gfmd-raw-block])").map(text),
    details: elements(comparable, "details").map((details) => ({
      open: (details as HTMLDetailsElement).open,
      summary: text(details.querySelector(":scope > summary")),
    })),
    images: elements<HTMLImageElement>(comparable, "img:not(.emoji)").map(
      (image) => [
        image.getAttribute("alt"),
        image.getAttribute("data-canonical-src") ?? image.getAttribute("src"),
      ],
    ),
    customEmoji: elements<HTMLImageElement>(comparable, "img.emoji").map(
      (image) => image.getAttribute("alt"),
    ),
    emojiText: text(
      elements(comparable, "p").find((paragraph) =>
        paragraph.textContent?.startsWith("Emoji shortcodes"),
      ) ?? null,
    ),
    footnotes: footnoteFingerprint(comparable),
  };
}

function listFingerprint(list: HTMLOListElement | HTMLUListElement): unknown {
  return {
    type: list.tagName,
    start:
      list instanceof HTMLOListElement
        ? Number(list.getAttribute("start") ?? "1")
        : undefined,
    items: elements<HTMLLIElement>(list, ":scope > li").map((item) => {
      const ownContent = item.cloneNode(true) as HTMLLIElement;
      ownContent.querySelectorAll("ol, ul").forEach((nested) => nested.remove());
      const checkbox = ownContent.querySelector<HTMLInputElement>(
        "input[type='checkbox']",
      );
      const checked = checkbox ? checkbox.checked : undefined;
      checkbox?.remove();

      return {
        checked,
        text: text(ownContent),
        children: ownedLists(item).map(listFingerprint),
      };
    }),
  };
}

function footnoteFingerprint(root: HTMLElement) {
  const editorDefinitions = elements<HTMLElement>(
    root,
    "[data-gfmd-footnote-definition]",
  );
  if (editorDefinitions.length > 0) {
    return editorDefinitions.map((definition) => ({
      identifier: definition.dataset.identifier,
      text: text(definition.querySelector(".gfmd-footnote-definition-content")),
    }));
  }

  return elements<HTMLLIElement>(root, "[data-footnotes] > ol > li").map(
    (definition) => {
      const content = definition.cloneNode(true) as HTMLLIElement;
      content
        .querySelectorAll("[data-footnote-backref]")
        .forEach((backReference) => backReference.remove());
      return {
        identifier: definition.id.match(/^user-content-fn-(.+?)-[a-f0-9]+$/)?.[1],
        text: text(content),
      };
    },
  );
}

function materializePreservedHtml(root: HTMLElement) {
  root
    .querySelectorAll<HTMLElement>(
      "[data-gfmd-raw-block][data-raw-kind='html_region']",
    )
    .forEach((raw) => {
      const template = document.createElement("template");
      template.innerHTML = raw.dataset.source ?? "";
      raw.replaceWith(template.content);
    });
}

function normalizeGitHubRendering(root: HTMLElement) {
  root.querySelectorAll("svg").forEach((svg) => svg.remove());
  root.querySelectorAll<HTMLElement>(".issue-link").forEach((link) => {
    link.textContent = link.getAttribute("href") ?? "";
  });
}

function alertFingerprint(alert: HTMLElement) {
  const kind =
    alert.dataset.alertKind ??
    [...alert.classList]
      .find((className) => className.startsWith("markdown-alert-"))
      ?.slice("markdown-alert-".length);
  const content = alert.cloneNode(true) as HTMLElement;
  content
    .querySelector(".gfmd-alert-title, .markdown-alert-title")
    ?.remove();

  return { kind, text: text(content) };
}

function ownedLists(item: HTMLLIElement) {
  const lists: Array<HTMLOListElement | HTMLUListElement> = [];
  const visit = (element: Element) => {
    for (const child of element.children) {
      if (child instanceof HTMLOListElement || child instanceof HTMLUListElement) {
        lists.push(child);
      } else if (!(child instanceof HTMLLIElement)) {
        visit(child);
      }
    }
  };
  visit(item);
  return lists;
}

function elements<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
) {
  return [...root.querySelectorAll<T>(selector)];
}

function text(element: Element | null) {
  if (!element) return "";

  const parts: string[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (!(node instanceof Element)) return;

    const separatesText = /^(BLOCKQUOTE|BR|DIV|H[1-6]|LI|P|PRE|SECTION|SUMMARY|TD|TH|TR)$/.test(
      node.tagName,
    );
    if (separatesText) parts.push(" ");
    node.childNodes.forEach(visit);
    if (separatesText) parts.push(" ");
  };
  visit(element);
  return parts.join("").replace(/\s+/g, " ").trim();
}
