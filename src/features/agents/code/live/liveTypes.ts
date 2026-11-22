export interface StepAuthor {
  kind: "person" | "agent";
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
}

export type RelativeJson = Record<string, unknown>;

export interface LiveStep {
  id: string;
  author: StepAuthor;
  path: string;
  at: number;
  summary: string;
  inserted: Array<{ start: RelativeJson; end: RelativeJson }>;
  deleted: Array<{ at: RelativeJson; text: string }>;
}

export interface LivePerson extends StepAuthor {
  gitName?: string;
  gitEmail?: string;
}

export const mainAuthor: StepAuthor = {
  kind: "person",
  id: "main",
  name: "main",
  ownerId: "main",
  ownerName: "main",
};

export function authorKey(author: Pick<StepAuthor, "kind" | "id" | "ownerId">): string {
  if (author.id === mainAuthor.id) return "main";
  return author.kind === "agent" ? `agent:${author.ownerId}:${author.id}` : `person:${author.id}`;
}

export const ownerKey = (author: Pick<StepAuthor, "ownerId">) =>
  author.ownerId === mainAuthor.id ? "main" : `person:${author.ownerId}`;

export interface LiveAwareness {
  user?: { id: string; name: string; color: string; colorLight: string };
  path?: string | null;
}

export interface LiveJoin {
  spaceId: string;
  spaceKey: string;
  spaceFolder: string;
  folder: string;
  sessionId: string;
  name: string;
  branch: string;
  baseCommit: string;
  repoKey: string;
  startedById: string;
  startedByName: string;
}

export interface FileChangedEvent {
  folder: string;
  path: string;
  text: string | null;
}

export interface LiveRepo {
  repoKey: string;
  root: string;
  head: string;
  branch: string | null;
  defaultBranch: string | null;
  baseOnRemote: boolean;
  mainAhead: number | null;
  fetchError: string | null;
  gitName: string | null;
  gitEmail: string | null;
}

export type LiveOutcome = "merged" | "pr" | "kept" | "discarded";
