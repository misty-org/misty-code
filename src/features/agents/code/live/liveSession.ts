import { spacesGateway } from "../../spaces-gateway/spacesGateway";
import { codeSessionsApi, type CodeSession } from "./codeSessionsApi";
import { followAgentRuns, onAgentRunEnded } from "./liveAgents";
import { liveApi } from "./liveApi";
import { startDiskMirror, type DiskMirror } from "./liveDisk";
import { acquireRoom, closeRoom, type LiveRoom } from "./liveRoom";
import { startStepRecorder, type StepRecorder } from "./liveSteps";
import { useLiveStore } from "./liveStore";
import { authorKey, type LiveJoin, type LiveRepo, type StepAuthor } from "./liveTypes";

interface Running {
  join: LiveJoin;
  room: LiveRoom;
  recorder: StepRecorder;
  mirror: DiskMirror;
  stops: Array<() => void>;
}

const running = new Map<string, Running>();
const starting = new Map<string, Promise<void>>();

const mainEveryMs = 5 * 60 * 1000;

export const runningSession = (sessionId: string): Running | undefined => running.get(sessionId);

export function me(): StepAuthor {
  const found = spacesGateway.maybe()?.me();
  if (!found) throw new Error("Sign in to work in live sessions.");
  return {
    kind: "person",
    id: found.userId,
    name: found.name,
    ownerId: found.userId,
    ownerName: found.name,
  };
}

export function sessionBranch(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "session";
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(2)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `misty/live/${slug}-${suffix}`;
}

function folders() {
  return Object.values(useLiveStore.getState().joins).map((join) => join.folder);
}

async function refreshMain(join: LiveJoin) {
  try {
    const repo = await liveApi.repo(join.folder, join.baseCommit, true);
    useLiveStore.getState().setMainAhead(join.sessionId, repo.mainAhead);
  } catch {
  }
}

function start(join: LiveJoin, repo: Pick<LiveRepo, "gitName" | "gitEmail">): Promise<void> {
  const known = starting.get(join.sessionId);
  if (known) return known;
  const store = useLiveStore.getState();
  store.setRoom(join.sessionId, "connecting");
  const work = (async () => {
    const room = await acquireRoom(join.spaceId, join.sessionId, me(), {
      gitName: repo.gitName ?? undefined,
      gitEmail: repo.gitEmail ?? undefined,
    });
    const recorder = startStepRecorder(room);
    const mirror = startDiskMirror(room, join);
    followAgentRuns(folders);
    const stops: Array<() => void> = [];
    stops.push(
      onAgentRunEnded((folder, agent) => {
        if (folder !== join.folder) return;
        recorder.closeAuthor(authorKey({ kind: "agent", id: agent.id, ownerId: room.me.id }));
      }),
    );
    stops.push(
      room.access.subscribe(() => {
        const lost = room.access.lost;
        if (lost)
          useLiveStore.getState().setRoom(join.sessionId, lost === "deleted" ? "ended" : "revoked");
      }),
    );
    const timer = window.setInterval(() => void refreshMain(join), mainEveryMs);
    stops.push(() => window.clearInterval(timer));
    running.set(join.sessionId, { join, room, recorder, mirror, stops });
    try {
      await room.ready;
    } catch (reason) {
      await stopRunning(join.sessionId);
      if (room.access.lost) return;
      throw reason;
    }
    if (!room.access.lost) useLiveStore.getState().setRoom(join.sessionId, "ready");
    void refreshMain(join);
  })();
  starting.set(join.sessionId, work);
  work.catch((reason) => {
    useLiveStore
      .getState()
      .setRoom(join.sessionId, "failed", reason instanceof Error ? reason.message : String(reason));
  });
  return work.finally(() => starting.delete(join.sessionId));
}

async function stopRunning(sessionId: string) {
  const found = running.get(sessionId);
  running.delete(sessionId);
  if (found) {
    found.recorder.closeAll();
    await found.mirror.stop();
    found.recorder.stop();
    for (const stop of found.stops) stop();
  }
  closeRoom(sessionId);
}

export async function joinSession(input: {
  spaceId: string;
  spaceKey: string;
  spaceFolder: string;
  session: CodeSession;
}): Promise<void> {
  const { session } = input;
  const repo = await liveApi.repo(input.spaceFolder, null, false);
  if (repo.repoKey !== session.repoKey)
    throw new Error("This folder is another repository, so it can't join this session.");
  const folder = await liveApi.createWorktree(
    input.spaceFolder,
    input.spaceKey,
    session.branch,
    session.baseCommit,
  );
  const join: LiveJoin = {
    spaceId: input.spaceId,
    spaceKey: input.spaceKey,
    spaceFolder: input.spaceFolder,
    folder,
    sessionId: session.id,
    name: session.name,
    branch: session.branch,
    baseCommit: session.baseCommit,
    repoKey: session.repoKey,
    startedById: session.startedBy.id,
    startedByName: session.startedBy.name,
  };
  useLiveStore.getState().setJoin(join);
  await start(join, repo);
}

export async function goLive(input: {
  spaceId: string;
  spaceKey: string;
  spaceFolder: string;
  name: string;
  repo: LiveRepo;
}): Promise<void> {
  const session = await codeSessionsApi.create(input.spaceId, {
    name: input.name,
    repoKey: input.repo.repoKey,
    baseCommit: input.repo.head,
    branch: sessionBranch(input.name),
  });
  await joinSession({ ...input, session });
}

export async function leaveSession(join: LiveJoin, keepBranch = false): Promise<void> {
  await stopRunning(join.sessionId);
  await liveApi.removeWorktree(join.spaceFolder, join.spaceKey, join.folder, !keepBranch);
  useLiveStore.getState().clearJoin(join.spaceFolder);
}

const restored = new Set<string>();

export function restoreJoin(spaceFolder: string) {
  const join = useLiveStore.getState().joins[spaceFolder];
  if (!join || restored.has(join.sessionId) || running.has(join.sessionId)) return;
  restored.add(join.sessionId);
  void (async () => {
    try {
      const session = await codeSessionsApi.get(join.spaceId, join.sessionId);
      if (session.endedAt) {
        const keep =
          session.startedBy.id === me().id &&
          session.outcome !== null &&
          session.outcome !== "discarded";
        await leaveSession(join, keep);
        return;
      }
      const repo = await liveApi.repo(join.spaceFolder, null, false);
      await start(join, repo);
    } catch (reason) {
      useLiveStore
        .getState()
        .setRoom(
          join.sessionId,
          "failed",
          reason instanceof Error ? reason.message : String(reason),
        );
    }
  })();
}

export function retryJoin(join: LiveJoin) {
  restored.delete(join.sessionId);
  restoreJoin(join.spaceFolder);
}
