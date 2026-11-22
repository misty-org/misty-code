import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useState } from "react";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { noAddon, type EditorAddon, type EditorAddonContext } from "../editorAddons";
import { liveEditorExtensions } from "./liveEditor";
import { runningSession } from "./liveSession";
import { joinHolding, useLiveStore } from "./liveStore";
import { authorKey } from "./liveTypes";

const locked: readonly Extension[] = [EditorState.readOnly.of(true), EditorView.editable.of(false)];

const textKey = (text: Y.Text) => {
  const id = text._item?.id;
  return id ? `${id.client}.${id.clock}` : "new";
};

type Bound = { path: string; text: Y.Text } | { path: string; refused: true } | null;

export function useLiveAddon(ctx: EditorAddonContext): EditorAddon {
  const join = useLiveStore((state) =>
    ctx.appearance === "page" ? joinHolding(state.joins, ctx.path) : null,
  );
  const roomState = useLiveStore((state) => (join ? state.rooms[join.sessionId] : undefined));
  const relative = join ? ctx.path.slice(join.folder.replace(/\/+$/, "").length + 1) : "";
  const running = join && roomState === "ready" ? runningSession(join.sessionId) : undefined;
  const [bound, setBound] = useState<Bound>(null);

  useEffect(() => {
    if (!running || !relative) return;
    let live = true;
    const read = () =>
      running.mirror.ensureText(relative).then(
        (text) => live && setBound({ path: relative, text }),
        () => live && setBound({ path: relative, refused: true }),
      );
    void read();
    const onFiles = (event: Y.YMapEvent<Y.Text>) => {
      if (event.keysChanged.has(relative)) void read();
    };
    running.room.files.observe(onFiles);
    return () => {
      live = false;
      running.room.files.unobserve(onFiles);
    };
  }, [running, relative]);

  const text = bound && bound.path === relative && "text" in bound ? bound.text : null;
  const refused = Boolean(bound && bound.path === relative && "refused" in bound);
  const undoManager = useMemo(
    () => (text ? new Y.UndoManager(text, { trackedOrigins: new Set() }) : null),
    [text],
  );
  useEffect(() => () => undoManager?.destroy(), [undoManager]);

  const extensions = useMemo<readonly Extension[] | null>(() => {
    if (!text || !running || !undoManager) return null;
    const { room, recorder } = running;
    return [
      yCollab(text, room.awareness, { undoManager }),
      liveEditorExtensions({
        room,
        text,
        path: relative,
        onSave: () => recorder.closeAuthor(authorKey(room.me)),
      }),
    ];
  }, [text, running, undoManager, relative]);

  const sessionId = join?.sessionId ?? "";
  const open = roomState === "ready";
  const diskText = ctx.diskText;
  return useMemo<EditorAddon>(() => {
    if (!sessionId || !relative || refused) return noAddon;
    if (text && extensions && open)
      return {
        extensions,
        document: { key: `${sessionId}:${relative}:${textKey(text)}`, text: text.toString() },
        savesItself: true,
      };
    return {
      extensions: locked,
      document: {
        key: `${sessionId}:${relative}:${text ? `closed:${textKey(text)}` : "waiting"}`,
        text: text ? text.toString() : diskText,
      },
      savesItself: true,
    };
  }, [sessionId, relative, refused, text, extensions, open, diskText]);
}
