import { runtimeAiApi } from "../../AgentsRuntime";
import { agentAccountId } from "../../personal/agentAccount";
import { usePersonalAgentsStore } from "../../personal/personalAgentsStore";
import { watchAllRunEvents } from "../../runs/local-run/localRunEvents";

interface RunHere {
  folder: string;
  at: number;
  paths: Set<string>;
}

const quietMs = 2 * 60 * 1000;
const ended = new Set(["invocation.completed", "invocation.failed", "invocation.canceled"]);

const runs = new Map<string, RunHere>();
const agentOfRun = new Map<string, Promise<{ id: string; name: string } | null>>();
const endListeners = new Set<(folder: string, agent: { id: string; name: string }) => void>();
let folders: () => readonly string[] = () => [];
let stopWatching: (() => void) | null = null;

function insideFolder(path: string): { folder: string; relative: string } | null {
  const clean = path.replace(/\\/g, "/");
  for (const folder of folders()) {
    const root = folder.replace(/\/+$/, "");
    if (clean.startsWith(`${root}/`)) return { folder, relative: clean.slice(root.length + 1) };
  }
  return null;
}

function agentFor(runId: string): Promise<{ id: string; name: string } | null> {
  let found = agentOfRun.get(runId);
  if (!found) {
    found = runtimeAiApi
      .activity("")
      .then(({ entries }) => {
        const agentId = entries.find((entry) => entry.run_id === runId)?.agent_id;
        if (!agentId) return null;
        const store = usePersonalAgentsStore.getState();
        if (!store.agents.length) void store.load(agentAccountId());
        const profile = store.agents.find((agent) => agent.id === agentId);
        return { id: agentId, name: profile?.name || "Agent" };
      })
      .catch(() => null);
    agentOfRun.set(runId, found);
  }
  return found;
}

export function followAgentRuns(current: () => readonly string[]) {
  folders = current;
  if (stopWatching) return;
  stopWatching = watchAllRunEvents((runId, event) => {
    const known = runs.get(runId);
    if (ended.has(event.type)) {
      runs.delete(runId);
      if (known)
        void agentFor(runId).then((agent) => {
          if (agent) for (const listener of endListeners) listener(known.folder, agent);
        });
      return;
    }
    if (event.type === "tool.started" && event.path) {
      const inside = insideFolder(event.path);
      if (inside) {
        const run = known ?? { folder: inside.folder, at: 0, paths: new Set<string>() };
        run.paths.add(inside.relative);
        run.at = Date.now();
        runs.set(runId, run);
        void agentFor(runId);
        return;
      }
    }
    if (known) known.at = Date.now();
  });
}

export function onAgentRunEnded(
  listener: (folder: string, agent: { id: string; name: string }) => void,
): () => void {
  endListeners.add(listener);
  return () => endListeners.delete(listener);
}

export async function agentEditing(
  folder: string,
  path: string,
): Promise<{ id: string; name: string } | null> {
  const now = Date.now();
  const here = [...runs.entries()]
    .filter(([, run]) => run.folder === folder && now - run.at < quietMs)
    .sort(
      (a, b) => Number(b[1].paths.has(path)) - Number(a[1].paths.has(path)) || b[1].at - a[1].at,
    );
  for (const [runId] of here) {
    const agent = await agentFor(runId);
    if (agent) return agent;
  }
  return null;
}
