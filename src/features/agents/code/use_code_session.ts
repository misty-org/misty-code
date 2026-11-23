import { useCallback, useEffect, useState } from "react";
import { useMistyStore } from "../conversations/state/use_misty_store";
import { useChatFolders } from "../shared-folders/chat_folder";
import { updateCodePageLayout, useCodePageLayout } from "./code_page_store";

export const openProject = (path: string) => updateCodePageLayout({ lastProject: path });

export const closeChat = () => updateCodePageLayout({ chat: "" });

export function useCodeChat() {
  const chat = useCodePageLayout((state) => state.value.chat);
  const exists = useMistyStore((state) =>
    chat ? state.conversations.some((item) => item.id === chat) : false,
  );
  const loading = useMistyStore((state) => state.conversationsLoading);
  const failed = useMistyStore((state) => Boolean(state.conversationsError));
  const read = useMistyStore((state) => state.conversations.length > 0);
  const gone = Boolean(chat) && !exists && read && !loading;
  useEffect(() => {
    if (gone) closeChat();
  }, [gone]);
  return { chat: exists ? chat : "", pending: Boolean(chat) && !exists && loading && !failed };
}

export function useCodeProject() {
  const lastProject = useCodePageLayout((state) => state.value.lastProject);
  const projects = useChatFolders((state) => state.projects);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    setFailed(false);
    void useChatFolders
      .getState()
      .loadProjects()
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [round]);
  const retry = useCallback(() => setRound((value) => value + 1), []);
  const folder = projects?.some((project) => project.path === lastProject)
    ? lastProject
    : (projects?.[0]?.path ?? "");
  return { folder, loaded: projects !== null, failed: failed && projects === null, retry };
}
