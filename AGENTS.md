# Agent instructions

## Product goal

Build a rich-text editor that supports GitHub Flavored Markdown, remains
interactive and structurally correct, and round-trips reliably between raw
Markdown and rich-text editing. Preserve original Markdown syntax on a
best-effort basis, prioritizing meaning and document structure over exact byte
identity.

Treat these as separate compatibility targets:

1. GFM specification features: CommonMark plus autolinks, tables, task lists,
   and strikethrough.
2. GitHub rendering extensions: footnotes, alerts, diagrams, math, details,
   mentions, issue and pull-request references, and other GitHub-specific
   constructs.

Document and test which target each feature belongs to. Do not describe partial
support as complete GFM or GitHub parity.

## Laws

All parser, schema, serializer, command, clipboard, and node-view changes must
preserve these laws.

### 1. Best-effort source identity

Opening Markdown in the rich editor and returning to raw text without an edit
should preserve the original source when practical. Canonicalization of
equivalent Markdown is acceptable, including changes to whitespace, delimiters,
list markers, heading style, code-fence style, and reference-link style.

Canonicalization must not change meaning, damage structure, discard content, or
make repeated round-trips continue changing the document. Preserve syntax that
cannot be safely regenerated, especially unsupported or malformed constructs.

### 2. Semantic identity

Serializing and reparsing an editor document must preserve the same document:

```text
parse(serialize(doc)) ≡ doc
```

Selection and transient UI state are excluded; document structure, attributes,
marks, and content are not.

### 3. Convergence

Serialization must stabilize:

```text
normalize(normalize(markdown)) = normalize(markdown)
```

Repeated raw/rich transitions must never progressively alter the document.

### 4. Localized rewriting

Prefer rewriting only the affected syntactic region. Whole-document
canonicalization is acceptable when required by the serializer, but avoid
unnecessary changes to unrelated content and prevent noisy rewrites where
source metadata makes localized output practical.

### 5. Total parsing

Every input must remain representable. Unsupported, malformed, or ambiguous
syntax must become an explicit opaque raw block or inline node. Never drop it,
silently reinterpret it, or escape it into different semantics.

### 6. Source and meaning are separate

The ProseMirror document represents semantic structure. Preserve concrete
Markdown syntax separately when required for correctness or valuable
best-effort fidelity, through raw slices, source ranges, syntax metadata, or an
equivalent representation.

Do not require a full concrete-syntax representation for syntax that can be
safely canonicalized. Prefer surrounding source style when regenerating edited
content.

### 7. List topology

A nested list is a child block of its owning list item. Parsing and every edit
operation must preserve that ownership. Never flatten, detach, duplicate, or
reparent descendants accidentally.

### 8. List metadata

Preserve ordered starts and delimiters, bullet characters, indentation, tight
or loose state, item-level spread, task state, multi-block item boundaries, and
nested container types unless the user explicitly changes them.

### 9. Transformation closure

Every editor command must produce a schema-valid document that the serializer
can represent without loss. Commands must preserve unaffected descendants,
marks, attributes, source metadata, selection intent, and undoability.

### 10. Safe raw HTML

Preserve raw HTML exactly. Rendering HTML is a separate security decision and
must use an explicit sanitization policy. Never achieve safety by destroying or
rewriting the source.

### 11. Explicit degradation

When rich editing is unavailable, render an identifiable raw or atomic node and
provide a source-editing path. Do not pretend escaped text is equivalent to the
original construct.

### 12. Test-defined compatibility

Compatibility claims must be backed by executable fixtures. Prefer official
CommonMark and GFM examples, supplemented by GitHub-specific fixtures and
regression tests.

## Nested-list requirements

Treat nested lists as a high-risk area. Changes involving lists must cover, as
applicable:

- Arbitrary-depth bullet, ordered, and task-list combinations
- Tight and loose lists
- Multi-paragraph items
- Blockquotes, code blocks, tables, details, and footnotes inside list items
- Ordered lists starting at values other than one
- Mixed selections during indent, outdent, and list-type conversion
- Enter and Backspace at empty and non-empty item boundaries
- Tab and Shift-Tab with descendants
- Copy and paste of nested selections
- Undo and redo after each structural operation

Do not infer correctness from rendered indentation alone. Assert the
ProseMirror tree, serialized Markdown, reparsed tree, and unaffected siblings.

## Required validation

For conversion behavior, test all relevant properties:

1. No-edit semantic identity and best-effort source preservation
2. `parse -> serialize -> parse` semantic identity
3. Serializer convergence
4. Locality of edits where source-preserving behavior exists
5. Preservation of unsupported or malformed input

Use table-driven regression fixtures for known edge cases and property-based or
generated tree tests for nested lists and overlapping inline marks.

Before declaring a Markdown feature complete, verify parsing, rich rendering,
interactive editing, clipboard behavior, serialization, controlled-value
updates, undo/redo, and accessibility. A parser-only implementation is not
complete editor support.

## Implementation guidance

- Whole-document `remark-stringify` output is acceptable for supported syntax
  when semantic identity and convergence are proven.
- Do not add syntax-specific normalization without an explicit product
  requirement and regression tests.
- Prefer shared schema-aware transformations over ad hoc position arithmetic.
- Preserve opaque source rather than guessing at unsupported syntax.
- Keep GFM parsing behavior independent from optional GitHub API enrichment.
- Treat a non-convergent serializer, semantic change, content loss, or
  structurally changed nested list as a release-blocking defect.
