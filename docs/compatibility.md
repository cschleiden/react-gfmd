# Markdown compatibility

## GitHub HTML rendering extensions

HTML support is a GitHub rendering extension, not part of the GFM feature set.
Source parsing and safe rich rendering remain separate: supported HTML receives
typed editor structure, while unsupported or unsafe HTML remains preserved
source and is never executed by the editor.

- Safe inline semantics are editable marks: `<ins>`, `<mark>`, `<kbd>`,
  `<samp>`, `<var>`, `<q>`, `<tt>`, `<sub>`, and `<sup>`. GitHub-compatible
  attributes are retained for `<ins>` and `<q>`.
- `<dl>`, `<dt>`, and `<dd>` become structured definition-list nodes.
- Balanced `<div>` and `<section>` boundaries become editable block containers.
  Their Markdown children stay structured, including nested safe containers.
  Safe rendering attributes are limited to `align`, `dir`, `id`, `lang`, and
  `title`; source boundaries retain the original attribute syntax.
- `<picture>` with safe `<source>` candidates and an `<img>` fallback becomes an
  atomic responsive-image node. Unsafe URLs, invalid source sets, and malformed
  pictures remain opaque source.
- Recognized GitHub emoji shortcodes render as Unicode emoji or GitHub-hosted
  custom emoji images while retaining their original `:name:` source. Escaped,
  unknown, code-span, and word-adjacent shortcode text remains literal.
- `<details>` is converted to its existing structured rich-text node. Supported
  standalone `<img>` tags are converted to Markdown image nodes.

## Unsupported and malformed HTML

- When remark parses Markdown between a balanced unsupported block HTML opener
  and closer, the HTML boundaries remain raw nodes while the Markdown body stays
  structured and editable, matching GitHub rendering behavior.
- When remark parses Markdown between a balanced unsupported block HTML opener
  and closer inside lists, blockquotes, footnotes, or safe containers, that
  structure remains owned by its Markdown container.
- A balanced unsupported region with no structured Markdown children is
  preserved as one atomic `raw_block`. Pairing is case-insensitive and
  stack-aware for nested same-name and mixed-name tags.
- Void elements, self-closing tags, standalone comments, and declarations remain
  individual raw nodes. Adjacent paired block regions remain separate.
- A mismatched or unclosed block region is preserved opaquely through the end of
  its current mdast container rather than interpreting uncertain content.
- HTML parsed inside a Markdown paragraph remains individual `raw_inline` nodes.
  Inline aggregation is intentionally avoided so surrounding paragraph text and
  marks remain editable and inline tag pairing does not consume unrelated text.

Raw nodes are read-only, selectable editor atoms with an accessible label.
Copying a selected region emits its preserved Markdown source, and pasting it
reconstructs the same atomic node.
