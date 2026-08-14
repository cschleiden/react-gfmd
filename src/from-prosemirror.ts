import type { FromProseMirrorOptions } from "@handlewithcare/remark-prosemirror";
import type {
  Nodes as MdastNode,
  Root,
  RootContent,
} from "mdast";
import type {
  Mark,
  Node as ProseMirrorNode,
} from "prosemirror-model";

type ConversionOptions = FromProseMirrorOptions<string, string>;

interface MarkedNode {
  node: ProseMirrorNode;
  marks: readonly Mark[];
}

interface ConversionState {
  one(
    node: ProseMirrorNode,
    parent?: ProseMirrorNode,
  ): MdastNode | MdastNode[] | null;
  all(node: ProseMirrorNode): MdastNode[];
  nodeHandlers: ConversionOptions["nodeHandlers"];
  markHandlers: ConversionOptions["markHandlers"];
}

export function fromProseMirrorStable(
  node: ProseMirrorNode,
  options: ConversionOptions,
): Root {
  const state = createState(options);
  const result = state.one(node);

  if (!result || Array.isArray(result) || result.type !== "root") {
    throw new Error("Expected the ProseMirror root to convert to an mdast root.");
  }

  return result;
}

function createState(options: ConversionOptions): ConversionState {
  const state: ConversionState = {
    one,
    all,
    nodeHandlers: options.nodeHandlers,
    markHandlers: options.markHandlers,
  };

  function one(
    node: ProseMirrorNode,
    parent?: ProseMirrorNode,
  ): MdastNode | MdastNode[] | null {
    const handler = state.nodeHandlers[node.type.name];
    if (handler) return handler(node, parent, state);

    if (node.type === node.type.schema.topNodeType) {
      return { type: "root", children: rootChildren(state.all(node)) };
    }

    if (node.isText) {
      return { type: "text", value: node.text ?? "" };
    }

    return null;
  }

  function all(node: ProseMirrorNode) {
    return hydrateMarks(
      node.children.map((child) => ({ node: child, marks: child.marks })),
      node,
      state,
    );
  }

  return state;
}

function hydrateMarks(
  children: MarkedNode[],
  parent: ProseMirrorNode,
  state: ConversionState,
): MdastNode[] {
  const output: MdastNode[] = [];
  let index = 0;

  while (index < children.length) {
    const child = children[index];
    const outerMark = longestActiveMark(children, index);

    if (!outerMark) {
      appendConverted(output, state.one(child.node, parent));
      index += 1;
      continue;
    }

    let end = index + 1;
    while (
      end < children.length &&
      children[end].marks.some((mark) => mark.eq(outerMark))
    ) {
      end += 1;
    }

    const markedChildren = hydrateMarks(
      children.slice(index, end).map(({ node, marks }) => ({
        node,
        marks: marks.filter((mark) => !mark.eq(outerMark)),
      })),
      parent,
      state,
    );
    const handler = state.markHandlers[outerMark.type.name];

    appendConverted(
      output,
      handler
        ? handler(outerMark, parent, markedChildren, state)
        : markedChildren,
    );
    index = end;
  }

  return output;
}

function longestActiveMark(children: MarkedNode[], index: number) {
  const marks = children[index].marks;
  let longest: Mark | undefined;
  let longestEnd = index;

  for (const mark of marks) {
    let end = index + 1;
    while (
      end < children.length &&
      children[end].marks.some((candidate) => candidate.eq(mark))
    ) {
      end += 1;
    }

    if (end > longestEnd) {
      longest = mark;
      longestEnd = end;
    }
  }

  return longest;
}

function rootChildren(nodes: MdastNode[]): RootContent[] {
  return nodes.map((node) => {
    if (node.type === "root") {
      throw new Error("Unexpected nested mdast root.");
    }
    return node;
  });
}

function appendConverted(
  output: MdastNode[],
  converted: MdastNode | MdastNode[] | null,
) {
  if (Array.isArray(converted)) {
    output.push(...converted);
  } else if (converted) {
    output.push(converted);
  }
}
