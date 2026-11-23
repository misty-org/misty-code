import { spacesGateway } from "../../spaces-gateway/spaces_gateway";

const spaceRequest = <T>(path: string, init?: RequestInit) =>
  spacesGateway.get().spaceRequest<T>(path, init);

export type CodeSessionOutcome = "merged" | "pr" | "kept" | "discarded";

export interface CodeSession {
  id: string;
  spaceId: string;
  name: string;
  repoKey: string;
  baseCommit: string;
  branch: string;
  startedBy: { id: string; name: string };
  createdAt: string;
  endedAt: string | null;
  outcome: CodeSessionOutcome | null;
}

export interface NewCodeSession {
  name: string;
  repoKey: string;
  baseCommit: string;
  branch: string;
}


function codeSessionPath(spaceId: string, sessionId?: string): string {
  const base = `/spaces/${encodeURIComponent(spaceId)}/code-sessions`;
  return sessionId ? `${base}/${encodeURIComponent(sessionId)}` : base;
}

export const codeSessionsApi = {
  list: (spaceId: string) => spaceRequest<{ sessions: CodeSession[] }>(codeSessionPath(spaceId)),
  create: (spaceId: string, session: NewCodeSession) =>
    spaceRequest<CodeSession>(codeSessionPath(spaceId), {
      method: "POST",
      body: JSON.stringify(session),
    }),
  get: (spaceId: string, sessionId: string) =>
    spaceRequest<CodeSession>(codeSessionPath(spaceId, sessionId)),
  end: (spaceId: string, sessionId: string, outcome: CodeSessionOutcome) =>
    spaceRequest<CodeSession>(`${codeSessionPath(spaceId, sessionId)}/end`, {
      method: "POST",
      body: JSON.stringify({ outcome }),
    }),
};
