import { describe, expect, it, vi } from "vitest";
import { createGitHubResolver } from "../src";

describe("createGitHubResolver", () => {
  it("resolves and caches issue references", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        number: 42,
        state: "open",
        title: "Issue title",
        html_url: "https://github.com/o/r/issues/42",
      }),
    );
    const resolver = createGitHubResolver({ owner: "o", repo: "r", fetch, cacheTtlMs: 10_000 });

    await expect(resolver.resolveReference({ number: 42, raw: "#42" }, { owner: "o", repo: "r" })).resolves.toMatchObject({
      number: 42,
      type: "issue",
      state: "open",
      title: "Issue title",
    });
    await resolver.resolveReference({ number: 42, raw: "#42" }, { owner: "o", repo: "r" });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("detects pull requests and sends auth headers", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test");
      return Response.json({
        number: 7,
        state: "closed",
        title: "Pull title",
        html_url: "https://github.com/o/r/issues/7",
        pull_request: {
          html_url: "https://github.com/o/r/pull/7",
        },
      });
    });
    const resolver = createGitHubResolver({
      owner: "o",
      repo: "r",
      fetch,
      getAuthHeaders: async () => ({ authorization: "Bearer test" }),
    });

    await expect(resolver.resolveReference({ number: 7, raw: "GH-7" }, { owner: "o", repo: "r" })).resolves.toMatchObject({
      type: "pull",
      state: "closed",
      url: "https://github.com/o/r/pull/7",
    });
  });

  it("resolves mentions", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        login: "monalisa",
        name: "Mona Lisa",
        avatar_url: "https://github.com/monalisa.png",
        html_url: "https://github.com/monalisa",
      }),
    );
    const resolver = createGitHubResolver({ owner: "o", repo: "r", fetch });

    await expect(resolver.resolveMention("monalisa", { owner: "o", repo: "r" })).resolves.toEqual({
      username: "monalisa",
      displayName: "Mona Lisa",
      avatarUrl: "https://github.com/monalisa.png",
      url: "https://github.com/monalisa",
    });
  });

  it("returns undefined for 404s", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    const resolver = createGitHubResolver({ owner: "o", repo: "r", fetch });

    await expect(resolver.resolveReference({ number: 404, raw: "#404" }, { owner: "o", repo: "r" })).resolves.toBeUndefined();
  });
});
