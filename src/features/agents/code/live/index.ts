import { useEffect, useMemo } from "react";
import { restoreJoin } from "./live_session";
import { useLiveStore } from "./live_store";

export { LiveMain, useLiveMainShown } from "./LiveMain";
export { LivePresence } from "./LivePresence";
export { LiveSidebar } from "./LiveSidebar";
export { useLiveAddon } from "./use_live_addon";

export function useLiveWorkFolder(
  spaceFolder: string,
): { folder: string; sessionId: string; name: string } | null {
  const join = useLiveStore((state) => (spaceFolder ? state.joins[spaceFolder] : undefined));
  useEffect(() => useLiveStore.getState().hydrate(), []);
  useEffect(() => {
    if (join) restoreJoin(spaceFolder);
  }, [join, spaceFolder]);
  return useMemo(
    () => (join ? { folder: join.folder, sessionId: join.sessionId, name: join.name } : null),
    [join],
  );
}
