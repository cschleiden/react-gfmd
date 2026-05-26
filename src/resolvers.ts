import type {
  GitHubMention,
  GitHubReference,
  GitHubResolverConfig,
  MentionResolver,
  MentionSuggestionProvider,
  ReferenceResolver,
  ReferenceSuggestionProvider,
  ReferenceToken,
} from "./types";

interface CacheEntry<T> {
  expiresAt: number;
  value: T | undefined;
}

interface GitHubIssueResponse {
  number: number;
  state: "open" | "closed";
  title?: string;
  html_url?: string;
  pull_request?: {
    html_url?: string;
    merged_at?: string | null;
  };
}

interface GitHubUserResponse {
  login: string;
  name?: string | null;
  avatar_url?: string;
  html_url?: string;
}

const defaultCacheTtlMs = 5 * 60 * 1000;

export function createGitHubResolver(config: GitHubResolverConfig): ReferenceResolver & MentionResolver {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const baseUrl = (config.baseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const cacheTtlMs = config.cacheTtlMs ?? defaultCacheTtlMs;
  const referenceCache = new Map<string, CacheEntry<GitHubReference>>();
  const mentionCache = new Map<string, CacheEntry<GitHubMention>>();

  async function requestJson<T>(path: string): Promise<T | undefined> {
    const headers = new Headers({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    const authHeaders = config.getAuthHeaders ? await config.getAuthHeaders() : undefined;
    if (authHeaders) {
      new Headers(authHeaders).forEach((value, key) => headers.set(key, value));
    }

    const response = await fetchImpl(`${baseUrl}${path}`, { headers });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`GitHub request failed with ${response.status}`);
    }
    return (await response.json()) as T;
  }

  return {
    async resolveReference(ref, context) {
      const resolved = normalizeReference(ref, context);
      const key = `${resolved.owner}/${resolved.repo}#${resolved.number}`;
      const cached = getCached(referenceCache, key);
      if (cached.hit) return cached.value;

      const issue = await requestJson<GitHubIssueResponse>(
        `/repos/${encodeURIComponent(resolved.owner)}/${encodeURIComponent(resolved.repo)}/issues/${resolved.number}`,
      );
      const value: GitHubReference | undefined = issue
        ? {
            owner: resolved.owner,
            repo: resolved.repo,
            number: issue.number,
            type: issue.pull_request ? "pull" : "issue",
            state: issue.pull_request?.merged_at ? "merged" : issue.state,
            title: issue.title,
            url: issue.pull_request?.html_url ?? issue.html_url,
          }
        : undefined;

      setCached(referenceCache, key, value, cacheTtlMs);
      return value;
    },

    async resolveMention(username) {
      const key = username.toLowerCase();
      const cached = getCached(mentionCache, key);
      if (cached.hit) return cached.value;

      const user = await requestJson<GitHubUserResponse>(`/users/${encodeURIComponent(username)}`);
      const value = user
        ? {
            username: user.login,
            displayName: user.name ?? undefined,
            avatarUrl: user.avatar_url,
            url: user.html_url,
          }
        : undefined;

      setCached(mentionCache, key, value, cacheTtlMs);
      return value;
    },
  };
}

export function createReferenceSuggestionProvider(
  resolver: ReferenceResolver,
): ReferenceSuggestionProvider {
  return {
    async searchReferences(query, context) {
      const match = query.match(/(?:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#|#|GH-)?(\d+)$/);
      if (!match) return [];
      const ref: ReferenceToken = {
        owner: match[1],
        repo: match[2],
        number: Number(match[3]),
        raw: match[0],
      };
      const value = await resolver.resolveReference(ref, context);
      return value
        ? [
            {
              ref,
              label: `${value.type === "pull" ? "PR" : "Issue"} #${value.number}`,
              detail: value.title,
              value,
            },
          ]
        : [];
    },
  };
}

export function createMentionSuggestionProvider(resolver: MentionResolver): MentionSuggestionProvider {
  return {
    async searchMentions(query, context) {
      const username = query.replace(/^@/, "").trim();
      if (!username) return [];
      const value = await resolver.resolveMention(username, context);
      return value
        ? [
            {
              username: value.username,
              label: `@${value.username}`,
              detail: value.displayName,
              value,
            },
          ]
        : [];
    },
  };
}

export function normalizeReference(ref: ReferenceToken, context: { owner: string; repo: string }) {
  return {
    owner: ref.owner ?? context.owner,
    repo: ref.repo ?? context.repo,
    number: ref.number,
  };
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): { hit: true; value: T | undefined } | { hit: false } {
  const entry = cache.get(key);
  if (!entry) return { hit: false };
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return { hit: false };
  }
  return { hit: true, value: entry.value };
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T | undefined, ttlMs: number) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}
