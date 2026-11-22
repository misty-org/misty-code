import type { LSPClient } from "@codemirror/lsp-client";
import { useEffect, useMemo, useState } from "react";
import { errorText } from "../../context-panel/projectApi";
import { noAddon, type EditorAddon, type EditorAddonContext } from "../editorAddons";
import { openServer, type ServerLease } from "./clients";
import { ensureInstalled } from "./install";
import { lspFileKind } from "./languages";
import { useLspStore } from "./lspStore";

interface Joined {
  key: string;
  client: LSPClient;
  uri: string;
  languageId: string;
}

export function useLspAddon(ctx: EditorAddonContext): EditorAddon {
  const { path, root, appearance } = ctx;
  const kind = appearance === "page" && root ? lspFileKind(path) : null;
  const language = kind?.language ?? null;
  const languageId = kind?.languageId ?? null;
  const attempt = useLspStore((state) => state.attempt);
  const key =
    language && languageId ? [language, languageId, root, path, attempt].join("\n") : null;
  const [joined, setJoined] = useState<Joined | null>(null);

  useEffect(() => {
    if (!key || !language || !languageId) return;
    let cancelled = false;
    let lease: ServerLease | null = null;
    const setFile = useLspStore.getState().setFile;
    setFile(path, { language, phase: "waiting" });
    void (async () => {
      try {
        await ensureInstalled(language);
        if (cancelled) return;
        setFile(path, { language, phase: "starting" });
        const opened = await openServer(language, root, path);
        if (cancelled) {
          opened.release();
          return;
        }
        lease = opened;
        const serverId = opened.connection.id;
        setJoined({ key, client: opened.connection.client, uri: opened.fileUri, languageId });
        setFile(path, { language, phase: "starting", serverId });
        await opened.connection.ready;
        if (!cancelled) setFile(path, { language, phase: "ready", serverId });
      } catch (error) {
        if (!cancelled) setFile(path, { language, phase: "failed", error: errorText(error) });
      }
    })();
    return () => {
      cancelled = true;
      lease?.release();
      useLspStore.getState().clearFile(path);
    };
  }, [key, language, languageId, path, root]);

  const current = joined && joined.key === key ? joined : null;
  const client = current?.client ?? null;
  const uri = current?.uri ?? null;
  const id = current?.languageId ?? null;
  return useMemo<EditorAddon>(
    () => (client && uri && id ? { extensions: [client.plugin(uri, id)] } : noAddon),
    [client, uri, id],
  );
}
