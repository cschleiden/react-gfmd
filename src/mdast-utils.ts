import type {
  Definition,
  Nodes as MdastNode,
  Parent as MdastParent,
  PhrasingContent,
} from "mdast";
import type { Node as ProseMirrorNode } from "prosemirror-model";

export function isPhrasingContent(
  node: MdastNode,
): node is PhrasingContent {
  return ![
    "blockquote",
    "break",
    "code",
    "definition",
    "details",
    "detailsSummary",
    "footnoteDefinition",
    "heading",
    "list",
    "listItem",
    "paragraph",
    "root",
    "table",
    "tableRow",
    "tableCell",
    "thematicBreak",
    "yaml",
  ].includes(node.type);
}

export interface HandlerState {
  all: (node: MdastNode) => ProseMirrorNode[];
  one: (
    node: MdastNode,
    parent: MdastParent | undefined,
  ) => ProseMirrorNode | ProseMirrorNode[] | null;
  definitionById?: Map<string, Definition>;
}

export interface FromProseMirrorState {
  one: (
    node: ProseMirrorNode,
    parent: ProseMirrorNode | undefined,
  ) => MdastNode | MdastNode[] | null;
  all: (node: ProseMirrorNode) => MdastNode[];
}
