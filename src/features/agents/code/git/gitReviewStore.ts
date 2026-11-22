import type { EditorView } from "@codemirror/view";
import { create } from "zustand";
import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agentAccount";

export type ReviewSource = "agent" | "disk";

export interface FileReview {
  before: string;
  source: ReviewSource;
}

export const useGitReview = create<{
  head: Record<string, string | null>;
  reviews: Record<string, FileReview>;
  comparing: Record<string, boolean>;
  clashes: Record<string, string>;
  counts: Record<string, number>;
  setCount(path: string, count: number): void;
  loadHead(path: string): Promise<void>;
  startReview(path: string, review: FileReview): void;
  endReview(path: string): void;
  setComparing(path: string, on: boolean): void;
  setClash(path: string, diskText: string | null): void;
}>((set, get) => ({
  head: {},
  reviews: {},
  comparing: {},
  clashes: {},
  counts: {},
  setCount(path, count) {
    if (get().counts[path] !== count) set({ counts: { ...get().counts, [path]: count } });
  },
  async loadHead(path) {
    try {
      const text = await invoke<string | null>("code_git_head_text", {
        account: agentAccountId(),
        path,
      });
      if (get().head[path] !== text) set({ head: { ...get().head, [path]: text } });
    } catch {
      if (get().head[path] !== null) set({ head: { ...get().head, [path]: null } });
    }
  },
  startReview(path, review) {
    set({
      reviews: { ...get().reviews, [path]: review },
      comparing: { ...get().comparing, [path]: false },
    });
  },
  endReview(path) {
    if (!(path in get().reviews)) return;
    const { [path]: _done, ...rest } = get().reviews;
    set({ reviews: rest });
  },
  setComparing(path, on) {
    set({ comparing: { ...get().comparing, [path]: on } });
  },
  setClash(path, diskText) {
    if (diskText === null) {
      if (!(path in get().clashes)) return;
      const { [path]: _gone, ...rest } = get().clashes;
      set({ clashes: rest });
    } else set({ clashes: { ...get().clashes, [path]: diskText } });
  },
}));

export const reviewViews = new Map<string, EditorView>();
