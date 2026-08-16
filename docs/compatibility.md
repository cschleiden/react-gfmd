# Markdown compatibility

## Raw HTML boundaries

Raw HTML is preserved and never executed by the editor.

- Supported block HTML, currently `<details>`, is converted to its structured
  rich-text node. Supported standalone `<img>` tags are converted to Markdown
  image nodes.
- An unsupported paired HTML tag parsed at a block-container boundary is
  preserved as one atomic `raw_block`, from its opening tag through the matching
  closing tag. Pairing is case-insensitive and stack-aware. Nested same-name and
  mixed-name tags, Markdown, comments, and blank lines remain opaque source.
- Void elements, self-closing tags, standalone comments, and declarations remain
  individual raw nodes. Adjacent paired block regions remain separate.
- A mismatched or unclosed block region is preserved opaquely through the end of
  its current mdast container rather than interpreting uncertain content.
- HTML parsed inside a Markdown paragraph remains individual `raw_inline` nodes.
  Inline aggregation is intentionally avoided so surrounding paragraph text and
  marks remain editable and inline tag pairing does not consume unrelated text.
- Raw regions nested in list items and blockquotes remain children of those
  containers. Container markers may be canonically regenerated during
  serialization, while the region's container-relative source remains exact.

Raw nodes are read-only, selectable editor atoms with an accessible label.
Copying a selected region emits its preserved Markdown source, and pasting it
reconstructs the same atomic node.
