import { Chunk, getChunks, unifiedMergeView } from "@codemirror/merge";
import { RangeSetBuilder, StateField, Text, type Extension } from "@codemirror/state";
import { gutter, GutterMarker, ViewPlugin, type EditorView } from "@codemirror/view";
import { useEffect, useMemo } from "react";
import { filesApi } from "../../context-panel/files/files_api";
import { useFilesStore } from "../../context-panel/files/files_store";
import { useGitStore } from "../../context-panel/git/store";
import { watchAllRunEvents } from "../../runs/local-run/local_run_events";
import { noAddon, type EditorAddon, type EditorAddonContext } from "../editor_addons";
import { reviewViews, useGitReview, type ReviewSource } from "./git_review_store";

type ChangeKind = "added" | "changed" | "removed";

class ChangeMarker extends GutterMarker {
  constructor(readonly kind: ChangeKind) {
    super();
  }
  eq(other: ChangeMarker) {
    return other.kind === this.kind;
  }
  toDOM() {
    const mark = document.createElement("span");
    mark.className = `cm-misty-change cm-misty-change-${this.kind}`;
    return mark;
  }
}

const markers: Record<ChangeKind, ChangeMarker> = {
  added: new ChangeMarker("added"),
  changed: new ChangeMarker("changed"),
  removed: new ChangeMarker("removed"),
};

const textOf = (text: string) => Text.of(text.split(/\r\n?|\n/));

function changeGutter(head: string, onOpen: () => void): Extension {
  const original = textOf(head);
  const chunks = StateField.define<readonly Chunk[]>({
    create: (state) => Chunk.build(original, state.doc),
    update: (value, tr) =>
      tr.docChanged ? Chunk.updateB(value, original, tr.newDoc, tr.changes) : value,
  });
  return [
    chunks,
    gutter({
      class: "cm-misty-changes",
      markers: (view) => {
        const builder = new RangeSetBuilder<GutterMarker>();
        const doc = view.state.doc;
        for (const chunk of view.state.field(chunks)) {
          if (chunk.fromB === chunk.toB) {
            const line = doc.lineAt(Math.min(chunk.fromB, doc.length));
            builder.add(line.from, line.from, markers.removed);
            continue;
          }
          const kind: ChangeKind = chunk.fromA === chunk.toA ? "added" : "changed";
          const first = doc.lineAt(chunk.fromB).number;
          const last = doc.lineAt(Math.min(chunk.endB, doc.length)).number;
          for (let number = first; number <= last; number += 1) {
            const line = doc.line(number);
            builder.add(line.from, line.from, markers[kind]);
          }
        }
        return builder.finish();
      },
      lineMarkerChange: (update) => update.docChanged,
      domEventHandlers: {
        mousedown: () => {
          onOpen();
          return true;
        },
      },
    }),
  ];
}

const noChanges = gutter({ class: "cm-misty-changes" });

function inlineChanges(path: string, original: string): Extension {
  const count = (view: EditorView) =>
    useGitReview.getState().setCount(path, getChunks(view.state)?.chunks.length ?? 0);
  return [
    unifiedMergeView({
      original: textOf(original),
      gutter: true,
      mergeControls: true,
      syntaxHighlightDeletions: true,
      allowInlineDiffs: true,
    }),
    ViewPlugin.define((view) => {
      queueMicrotask(() => count(view));
      return {
        update: (update) => count(update.view),
        destroy: () => useGitReview.getState().setCount(path, 0),
      };
    }),
  ];
}

function registerView(path: string): Extension {
  return ViewPlugin.define((view: EditorView) => {
    reviewViews.set(path, view);
    return {
      destroy() {
        if (reviewViews.get(path) === view) reviewViews.delete(path);
      },
    };
  });
}

const SETTLE_MS = 800;

async function checkDisk(path: string, source: ReviewSource) {
  const files = useFilesStore.getState();
  const entry = files.fileStates[path];
  const shown = entry?.content?.kind === "text" ? entry.content.text : null;
  if (shown === null || entry?.loading) return;
  let disk: string | null;
  try {
    const read = await filesApi.readFile(path);
    disk = read.kind === "text" && !read.truncated ? read.text : null;
  } catch {
    return;
  }
  if (disk === null || disk === shown) return;
  const review = useGitReview.getState();
  if (useFilesStore.getState().dirtyPaths[path]) {
    review.setClash(path, disk);
    return;
  }
  const before = review.reviews[path]?.before ?? shown;
  review.startReview(path, { before, source: review.reviews[path]?.source ?? source });
  await useFilesStore.getState().reloadFile(path);
}

export function useGitAddon(ctx: EditorAddonContext, options: { live: boolean }): EditorAddon {
  const { path, appearance } = ctx;
  const active = appearance === "page" && !options.live;
  const head = useGitReview((state) => state.head[path]);
  const review = useGitReview((state) => state.reviews[path]);
  const comparing = useGitReview((state) => state.comparing[path] ?? false);

  useEffect(() => {
    if (!active) return;
    const load = () => void useGitReview.getState().loadHead(path);
    load();
    let timer: number | undefined;
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 500);
    };
    const stopGit = useGitStore.subscribe((state, previous) => {
      if (state.statusByWorkspace !== previous.statusByWorkspace) later();
    });
    window.addEventListener("focus", load);
    return () => {
      window.clearTimeout(timer);
      stopGit();
      window.removeEventListener("focus", load);
    };
  }, [active, path]);

  useEffect(() => {
    if (!active) return;
    let timer: number | undefined;
    const stopRuns = watchAllRunEvents((_run, event) => {
      if (!event.type.startsWith("tool.")) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void checkDisk(path, "agent"), SETTLE_MS);
    });
    const onFocus = () => void checkDisk(path, "disk");
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(timer);
      stopRuns();
      window.removeEventListener("focus", onFocus);
    };
  }, [active, path]);

  return useMemo(() => {
    if (!active) return noAddon;
    const view = registerView(path);
    if (review) return { extensions: [view, inlineChanges(path, review.before)] };
    if (typeof head !== "string") return { extensions: [view, noChanges] };
    if (comparing) return { extensions: [view, inlineChanges(path, head)] };
    return {
      extensions: [
        view,
        changeGutter(head, () => useGitReview.getState().setComparing(path, true)),
      ],
    };
  }, [active, path, head, review, comparing]);
}
