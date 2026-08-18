import type { Node as ProseMirrorNode } from "prosemirror-model";
import { gfmSchema } from "../../schema";

export interface FootnoteDefinition {
  readonly identifier: string;
  readonly label: string;
}

export interface FootnoteEntry extends FootnoteDefinition {
  readonly definitionPositions: readonly number[];
  readonly nodePositions: readonly number[];
  readonly referencePositions: readonly number[];
}

export interface FootnoteIndex {
  readonly definitions: readonly FootnoteDefinition[];
  entries: ReadonlyMap<string, FootnoteEntry>;
  occupiedIdentifiers: ReadonlySet<string>;
}

interface MutableFootnoteEntry {
  identifier: string;
  label: string;
  definitionPositions: number[];
  nodePositions: number[];
  referencePositions: number[];
}

export function indexFootnotes(doc: ProseMirrorNode): FootnoteIndex {
  const entries = new Map<string, MutableFootnoteEntry>();
  const definitions: FootnoteDefinition[] = [];
  const occupiedIdentifiers = new Set<string>();

  doc.descendants((node, pos) => {
    if (
      node.type !== gfmSchema.nodes.footnote_reference &&
      node.type !== gfmSchema.nodes.footnote_definition
    ) {
      return true;
    }

    const identifier = String(node.attrs.identifier);
    const label = String(node.attrs.label ?? identifier);
    const key = normalizeFootnoteIdentifier(identifier);
    const entry = entries.get(key) ?? {
      identifier,
      label,
      definitionPositions: [],
      nodePositions: [],
      referencePositions: [],
    };

    entry.nodePositions.push(pos);
    occupiedIdentifiers.add(key);
    occupiedIdentifiers.add(normalizeFootnoteIdentifier(label));

    if (node.type === gfmSchema.nodes.footnote_definition) {
      if (!entry.definitionPositions.length) {
        entry.identifier = identifier;
        entry.label = label;
        definitions.push({ identifier, label });
      }
      entry.definitionPositions.push(pos);
    } else {
      entry.referencePositions.push(pos);
    }

    entries.set(key, entry);
    return node.type === gfmSchema.nodes.footnote_definition;
  });

  return { definitions, entries, occupiedIdentifiers };
}

export function footnoteEntry(
  index: FootnoteIndex,
  identifier: string,
) {
  return index.entries.get(normalizeFootnoteIdentifier(identifier));
}

export function footnoteDefinitionOrdinal(
  index: FootnoteIndex,
  identifier: string,
) {
  const entry = footnoteEntry(index, identifier);
  if (!entry?.definitionPositions.length) return null;

  const definitionIndex = index.definitions.findIndex(
    (definition) =>
      normalizeFootnoteIdentifier(definition.identifier) ===
      normalizeFootnoteIdentifier(entry.identifier),
  );
  return definitionIndex >= 0 ? definitionIndex + 1 : null;
}

export function footnoteDefinitions(doc: ProseMirrorNode): FootnoteDefinition[] {
  return indexFootnotes(doc).definitions.map(({ identifier, label }) => ({
    identifier,
    label,
  }));
}

export function placeFootnoteDefinitionsAtDocumentEnd(doc: ProseMirrorNode) {
  const content: ProseMirrorNode[] = [];
  const definitions: ProseMirrorNode[] = [];
  let foundDefinition = false;
  let needsReordering = false;

  doc.forEach((node) => {
    if (node.type === gfmSchema.nodes.footnote_definition) {
      foundDefinition = true;
      definitions.push(node);
      return;
    }

    if (foundDefinition) needsReordering = true;
    content.push(node);
  });

  if (!needsReordering) return doc;
  return doc.type.create(doc.attrs, [...content, ...definitions], doc.marks);
}

export function normalizeFootnoteIdentifier(label: string) {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}
