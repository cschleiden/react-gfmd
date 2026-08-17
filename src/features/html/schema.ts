import type {
  DOMOutputSpec,
  MarkSpec,
  NodeSpec,
} from "prosemirror-model";
import { isSafeInteractionHref } from "../../link-url";

export interface SafeHtmlAttributes {
  align?: string;
  dir?: string;
  id?: string;
  lang?: string;
  title?: string;
}

export interface PictureSource {
  media?: string;
  srcset: string;
  type?: string;
}

export interface PictureImage {
  alt?: string;
  height?: string;
  src: string;
  title?: string;
  width?: string;
}

export const definitionListNodeSpec: NodeSpec = {
  content: "(definition_term definition_description+)+",
  group: "block",
  defining: true,
  parseDOM: [{ tag: "dl" }],
  toDOM: () => ["dl", { "data-gfmd-definition-list": "" }, 0],
};

export const definitionTermNodeSpec: NodeSpec = {
  content: "inline*",
  defining: true,
  parseDOM: [{ tag: "dt" }],
  toDOM: () => ["dt", 0],
};

export const definitionDescriptionNodeSpec: NodeSpec = {
  content: "block+",
  defining: true,
  parseDOM: [{ tag: "dd" }],
  toDOM: () => ["dd", 0],
};

export const safeHtmlContainerNodeSpec: NodeSpec = {
  attrs: {
    attrs: { default: {} },
    sourceClose: { default: "" },
    sourceOpen: { default: "" },
    tagName: { validate: "string" },
  },
  content: "block+",
  group: "block",
  defining: true,
  parseDOM: [
    {
      tag: "[data-gfmd-html-container]",
      getAttrs: (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const tagName = node.dataset.tagName;
        if (tagName !== "div" && tagName !== "section") return false;
        return {
          attrs: parseJsonAttribute(node.dataset.htmlAttrs),
          sourceClose: node.dataset.sourceClose ?? `</${tagName}>`,
          sourceOpen: node.dataset.sourceOpen ?? `<${tagName}>`,
          tagName,
        };
      },
    },
  ],
  toDOM: (node) => {
    const tagName = node.attrs.tagName === "section" ? "section" : "div";
    return [
      tagName,
      {
        ...safeContainerDOMAttributes(node.attrs.attrs),
        "data-gfmd-html-container": "",
        "data-html-attrs": JSON.stringify(node.attrs.attrs),
        "data-source-close": node.attrs.sourceClose,
        "data-source-open": node.attrs.sourceOpen,
        "data-tag-name": tagName,
      },
      0,
    ];
  },
};

export const pictureNodeSpec: NodeSpec = {
  attrs: {
    image: { default: null },
    source: { validate: "string" },
    sources: { default: [] },
  },
  atom: true,
  group: "block",
  selectable: true,
  parseDOM: [
    {
      tag: "picture",
      getAttrs: (node) => {
        if (!(node instanceof HTMLElement)) return false;
        if (!node.hasAttribute("data-gfmd-picture")) {
          return pictureAttrsFromDOM(node);
        }
        const image = parseJsonAttribute(node.dataset.image);
        const sources = parseJsonAttribute(node.dataset.sources);
        return {
          image,
          source: node.dataset.source ?? "",
          sources: Array.isArray(sources) ? sources : [],
        };
      },
    },
  ],
  toDOM: (node) => {
    const image = node.attrs.image as PictureImage;
    const sources = node.attrs.sources as PictureSource[];
    const children: DOMOutputSpec[] = sources.map((source) => [
      "source",
      safePictureSourceAttributes(source),
    ]);
    children.push(["img", safePictureImageAttributes(image)]);

    return [
      "picture",
      {
        "aria-label": image.alt || "Picture",
        contenteditable: "false",
        "data-gfmd-picture": "",
        "data-image": JSON.stringify(image),
        "data-source": node.attrs.source,
        "data-sources": JSON.stringify(sources),
      },
      ...children,
    ];
  },
};

export const safeHtmlMarkSpecs: Record<string, MarkSpec> = {
  highlight: htmlMarkSpec("mark"),
  insert: htmlMarkSpec("ins", ["cite", "datetime"]),
  keyboard_input: htmlMarkSpec("kbd"),
  quote: htmlMarkSpec("q", ["cite"]),
  sample_output: htmlMarkSpec("samp"),
  teletype: htmlMarkSpec("tt"),
  variable: htmlMarkSpec("var"),
};

function htmlMarkSpec(tagName: string, attributes: string[] = []): MarkSpec {
  return {
    attrs: Object.fromEntries(attributes.map((name) => [name, { default: null }])),
    parseDOM: [
      {
        tag: tagName,
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return {};
          return Object.fromEntries(
            attributes.map((name) => [name, node.getAttribute(name)]),
          );
        },
      },
    ],
    toDOM: (mark) => [
      tagName,
      Object.fromEntries(
        attributes
          .map((name) => [name, mark.attrs[name]])
          .filter(([, value]) => typeof value === "string" && value),
      ),
      0,
    ],
  };
}

function pictureAttrsFromDOM(node: HTMLElement) {
  const imageElement = node.querySelector(":scope > img");
  if (!(imageElement instanceof HTMLImageElement)) return false;
  const src = imageElement.getAttribute("src");
  if (!src || !isSafeInteractionHref(src)) return false;

  const sources: PictureSource[] = [];
  for (const source of node.querySelectorAll(":scope > source")) {
    const srcset = source.getAttribute("srcset");
    if (!srcset || !safeSrcset(srcset)) return false;
    sources.push({
      media: source.getAttribute("media") ?? undefined,
      srcset,
      type: source.getAttribute("type") ?? undefined,
    });
  }

  return {
    image: {
      alt: imageElement.getAttribute("alt") ?? undefined,
      height: imageElement.getAttribute("height") ?? undefined,
      src,
      title: imageElement.getAttribute("title") ?? undefined,
      width: imageElement.getAttribute("width") ?? undefined,
    },
    source: node.outerHTML,
    sources,
  };
}

function safeContainerDOMAttributes(value: unknown) {
  const attrs = isRecord(value) ? value : {};
  const output: Record<string, string> = {};

  for (const name of ["align", "dir", "lang", "title"] as const) {
    if (typeof attrs[name] === "string" && attrs[name]) {
      output[name] = attrs[name];
    }
  }
  if (typeof attrs.id === "string" && attrs.id) {
    output.id = `gfmd-user-content-${attrs.id}`;
  }
  return output;
}

function safePictureSourceAttributes(source: PictureSource) {
  return {
    media: source.media,
    srcSet: safeSrcset(source.srcset) ? source.srcset : undefined,
    type: source.type,
  };
}

function safePictureImageAttributes(image: PictureImage) {
  return {
    alt: image.alt ?? "",
    height: image.height,
    src: isSafeInteractionHref(image.src) ? image.src : undefined,
    title: image.title,
    width: image.width,
  };
}

export function safeSrcset(value: string) {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0])
    .every((url) => url && isSafeInteractionHref(url));
}

function parseJsonAttribute(value: string | undefined): unknown {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
