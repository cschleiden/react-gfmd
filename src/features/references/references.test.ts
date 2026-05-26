import { describe, expect, it } from "vitest";
import { gfmSchema } from "../../schema";
import { parseReferenceToken, serializeReferenceNode } from "./markdown";

describe("references feature", () => {
  it("parses bare, GH, and cross-repo tokens", () => {
    expect(parseReferenceToken(gfmSchema, "#123")?.attrs).toMatchObject({ number: 123, raw: "#123" });
    expect(parseReferenceToken(gfmSchema, "GH-123")?.attrs).toMatchObject({ number: 123, raw: "GH-123" });
    expect(parseReferenceToken(gfmSchema, "owner/repo#123")?.attrs).toMatchObject({
      owner: "owner",
      repo: "repo",
      number: 123,
      raw: "owner/repo#123",
    });
  });

  it("serializes using the original raw token", () => {
    const node = parseReferenceToken(gfmSchema, "owner/repo#123")!;

    expect(serializeReferenceNode(node)).toBe("owner/repo#123");
  });
});
