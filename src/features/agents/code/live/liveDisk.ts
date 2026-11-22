import { getCurrentWebview } from "@tauri-apps/api/webview";
import * as Y from "yjs";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { agentEditing } from "./liveAgents";
import { FILE_CHANGED_EVENT, liveApi } from "./liveApi";
import { seedAs, transactAs, type LiveRoom } from "./liveRoom";
import { outsideEdits } from "./liveText";
import type { FileChangedEvent, LiveJoin, StepAuthor } from "./liveTypes";

const writeDelayMs = 250;

export interface DiskMirror {
  ensureText(path: string): Promise<Y.Text>;
  stop(): Promise<void>;
}

export function startDiskMirror(room: LiveRoom, join: LiveJoin): DiskMirror {
  const seeds = new Map<string, Promise<Y.Text>>();
  const timers = new Map<string, number>();
  const queues = new Map<string, Promise<void>>();
  const onDisk = new Map<string, string>();
  const refused = new Set<string>();
  let stopped = false;

  const queue = (path: string, work: () => Promise<void>) => {
    const next = (queues.get(path) ?? Promise.resolve()).then(work).catch(() => undefined);
    queues.set(path, next);
    return next;
  };

  function ensureText(path: string): Promise<Y.Text> {
    const have = room.files.get(path);
    if (have) return Promise.resolve(have);
    let pending = seeds.get(path);
    if (!pending) {
      pending = room.ready
        .then(async (): Promise<Y.Text> => {
          const present = room.files.get(path);
          if (present) return present;
          const base = await liveApi.baseFile(join.folder, join.baseCommit, path);
          if (!room.files.has(path))
            seedAs(room, () => room.files.set(path, new Y.Text(base ?? "")));
          return room.files.get(path)!;
        })
        .finally(() => seeds.delete(path));
      seeds.set(path, pending);
    }
    return pending;
  }

  const schedule = (path: string) => {
    if (stopped || refused.has(path)) return;
    window.clearTimeout(timers.get(path));
    timers.set(
      path,
      window.setTimeout(() => {
        timers.delete(path);
        void queue(path, () => write(path));
      }, writeDelayMs),
    );
  };

  async function write(path: string) {
    const text = room.files.get(path);
    if (!text || stopped) return;
    const content = text.toString();
    const outside = await liveApi.write(join.folder, path, content);
    if (outside === null) {
      onDisk.set(path, content);
      return;
    }
    await takeIn(path, outside);
    schedule(path);
  }

  async function takeIn(path: string, outside: string) {
    let text: Y.Text;
    try {
      text = await ensureText(path);
    } catch {
      refused.add(path);
      return;
    }
    const base = onDisk.get(path) ?? text.toString();
    onDisk.set(path, outside);
    if (outside === base) return;
    const agent = await agentEditing(join.folder, path);
    const author: StepAuthor = agent
      ? {
          kind: "agent",
          id: agent.id,
          name: agent.name,
          ownerId: room.me.id,
          ownerName: room.me.name,
        }
      : room.me;
    transactAs(room, author, "disk", () => {
      for (const edit of outsideEdits(text.toString(), base, outside)) {
        if (edit.to > edit.from) text.delete(edit.from, edit.to - edit.from);
        if (edit.insert) text.insert(edit.from, edit.insert);
      }
    });
  }

  const onChange = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>) => {
    for (const event of events) {
      if (event.target === room.files) {
        for (const key of (event as Y.YMapEvent<Y.Text>).keysChanged) schedule(key);
        continue;
      }
      const path = event.path[0];
      if (typeof path === "string") schedule(path);
    }
  };

  let unlisten: (() => void) | null = null;
  const listening =
    hasTauriInternals() &&
    getCurrentWebview()
      .listen<FileChangedEvent>(FILE_CHANGED_EVENT, ({ payload }) => {
        if (stopped || payload.folder !== join.folder) return;
        void queue(payload.path, async () => {
          if (payload.text === null) schedule(payload.path);
          else await takeIn(payload.path, payload.text);
        });
      })
      .then((stop) => {
        unlisten = stop;
      });

  const started = room.ready.then(async () => {
    if (stopped) return;
    room.files.observeDeep(onChange);
    const paths = [...room.files.keys()];
    await Promise.all(paths.map((path) => queue(path, () => write(path))));
    if (!stopped) await liveApi.watch(join.folder, paths);
  });

  return {
    ensureText,
    async stop() {
      stopped = true;
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
      room.files.unobserveDeep(onChange);
      await started.catch(() => undefined);
      await Promise.all(queues.values());
      await listening;
      unlisten?.();
      await liveApi.unwatch(join.folder).catch(() => undefined);
    },
  };
}
