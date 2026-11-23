import { forEachDiagnostic } from "@codemirror/lint";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useMemo } from "react";
import { create } from "zustand";
import { noAddon, type EditorAddon, type EditorAddonContext } from "./editor_addons";

export interface EditorStatus {
  line: number;
  column: number;
  vimMode?: string;
  errors?: number;
  warnings?: number;
}

const same = (a: EditorStatus, b: EditorStatus) =>
  a.line === b.line &&
  a.column === b.column &&
  a.vimMode === b.vimMode &&
  (a.errors ?? 0) === (b.errors ?? 0) &&
  (a.warnings ?? 0) === (b.warnings ?? 0);

export const useCodeStatus = create<{
  byPath: Record<string, EditorStatus>;
  update(path: string, patch: Partial<EditorStatus>): void;
  forget(path: string): void;
}>((set, get) => ({
  byPath: {},
  update(path, patch) {
    const current = get().byPath[path] ?? { line: 1, column: 1 };
    const next = { ...current, ...patch };
    if (same(next, current) && get().byPath[path]) return;
    set({ byPath: { ...get().byPath, [path]: next } });
  },
  forget(path) {
    if (!(path in get().byPath)) return;
    const { [path]: _gone, ...rest } = get().byPath;
    set({ byPath: rest });
  },
}));

function problems(state: EditorState): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  forEachDiagnostic(state, (diagnostic) => {
    if (diagnostic.severity === "error") errors += 1;
    else if (diagnostic.severity === "warning") warnings += 1;
  });
  return { errors, warnings };
}

export function useStatusAddon(ctx: EditorAddonContext): EditorAddon {
  const { path, appearance } = ctx;
  return useMemo(() => {
    if (appearance !== "page") return noAddon;
    const report = (view: EditorView) => {
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      useCodeStatus.getState().update(path, { line: line.number, column: head - line.from + 1 });
    };
    return {
      extensions: [
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.docChanged || update.focusChanged) report(update.view);
          if (update.docChanged || update.transactions.some((tr) => tr.effects.length > 0))
            useCodeStatus.getState().update(path, problems(update.state));
        }),
      ],
    };
  }, [path, appearance]);
}
