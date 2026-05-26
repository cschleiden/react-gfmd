export type AlertKind = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

export interface EditorContext {
  owner: string;
  repo: string;
}

export interface ReferenceToken {
  owner?: string;
  repo?: string;
  number: number;
  raw: string;
}

export interface GitHubReference extends Required<Pick<ReferenceToken, "owner" | "repo" | "number">> {
  type: "issue" | "pull";
  state: "open" | "closed" | "merged" | "unknown";
  title?: string;
  url?: string;
}

export interface GitHubMention {
  username: string;
  displayName?: string;
  avatarUrl?: string;
  url?: string;
}

export interface ResolvedValue<T> {
  status: "loading" | "resolved" | "missing" | "error";
  value?: T;
  error?: unknown;
}

export interface ReferenceResolver {
  resolveReference(ref: ReferenceToken, context: EditorContext): Promise<GitHubReference | undefined>;
}

export interface MentionResolver {
  resolveMention(username: string, context: EditorContext): Promise<GitHubMention | undefined>;
}

export interface GitHubResolverConfig extends EditorContext {
  baseUrl?: string;
  cacheTtlMs?: number;
  fetch?: typeof fetch;
  getAuthHeaders?: () => HeadersInit | Promise<HeadersInit>;
}

export interface ReferenceSuggestionItem {
  ref: ReferenceToken;
  label: string;
  detail?: string;
  value?: GitHubReference;
}

export interface MentionSuggestionItem {
  username: string;
  label: string;
  detail?: string;
  value?: GitHubMention;
}

export interface ReferenceSuggestionProvider {
  searchReferences(query: string, context: EditorContext): Promise<ReferenceSuggestionItem[]>;
}

export interface MentionSuggestionProvider {
  searchMentions(query: string, context: EditorContext): Promise<MentionSuggestionItem[]>;
}
