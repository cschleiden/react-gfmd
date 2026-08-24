# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People writing Markdown in rich-text editors embedded in host applications.
Library integrators are a secondary audience.

## Product Purpose

React GFMD provides an interactive rich-text editing experience for GitHub
Flavored Markdown and GitHub-specific extensions while keeping raw Markdown
available for reliable round-tripping.

## Positioning

The editor treats Markdown source fidelity, semantic document identity, and
schema-correct interactive editing as separate requirements rather than
trading one away for another.

## Operating Context

The product is distributed as a React package and embedded into other web
applications. Writers move between rich editing and raw Markdown, use familiar
formatting controls and keyboard shortcuts, and work with structured content
such as nested lists, tables, alerts, details, links, and footnotes.

## Capabilities and Constraints

- Preserve document meaning and structure across parse, edit, serialize, and
  reparse cycles.
- Preserve unsupported or malformed source as explicit raw content.
- Keep editor commands schema-valid, undoable, and compatible with controlled
  React updates.
- Keep GFM support distinct from optional GitHub rendering extensions.
- Expose host-application controls for editor chrome without coupling them to
  Markdown parsing or serialization.

## Evidence on Hand

The repository includes executable editor, Markdown, clipboard, list, alert,
details, footnote, color, reference, and demo-rendering tests. No external
customer claims or usage metrics are present and none should be fabricated.

## Product Principles

- Preserve meaning and structure before exact byte identity.
- Make advanced Markdown features discoverable without blocking direct typing.
- Keep contextual controls relevant, compact, and reversible.
- Degrade unsupported syntax explicitly instead of silently changing it.
- Treat nested lists and overlapping inline marks as high-risk structures.

## Accessibility & Inclusion

Editor controls must remain keyboard operable, expose meaningful accessible
names and states, preserve visible focus, and avoid relying on pointer-only
selection or interaction.
