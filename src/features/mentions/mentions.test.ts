import { describe, expect, it } from "vitest";
import { gfmSchema } from "../../schema";
import { parseMentionToken, serializeMentionNode } from "./markdown";

describe("mentions feature", () => {
  it("parses valid mention tokens", () => {
    expect(parseMentionToken(gfmSchema, "@monalisa")?.attrs).toEqual({ username: "monalisa" });
  });

  it("serializes mention tokens", () => {
    const node = parseMentionToken(gfmSchema, "@monalisa")!;

    expect(serializeMentionNode(node)).toBe("@monalisa");
  });
});
