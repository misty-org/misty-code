import type { Room } from "@misty/sdk";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { spacesGateway } from "../../spaces-gateway/spaces_gateway";
import { personColor } from "@/shared/lib/person_tone";
import { useCursorTone, useShowInLive } from "./live_visibility";
import {
  authorKey,
  mainAuthor,
  type LivePerson,
  type LiveStep,
  type StepAuthor,
} from "./live_types";

export class LiveOrigin {
  constructor(
    readonly author: StepAuthor,
    readonly reason: "disk" | "undo" | "main" | "seed" | "step" | "people",
  ) {}
}

export interface LiveAccess {
  readonly lost: "deleted" | "revoked" | null;
  subscribe(listener: () => void): () => void;
}

export interface LiveRoom {
  sessionId: string;
  spaceId: string;
  doc: Y.Doc;
  files: Y.Map<Y.Text>;
  steps: Y.Array<LiveStep>;
  people: Y.Map<LivePerson>;
  users: Y.PermanentUserData;
  live: Room;
  awareness: Awareness;
  access: LiveAccess;
  me: StepAuthor;
  ready: Promise<void>;
  isReady(): boolean;
}

const authorClients = new WeakMap<Y.Doc, Map<string, number>>();

const randomClient = () => crypto.getRandomValues(new Uint32Array(1))[0]!;

export function transactionAuthor(room: LiveRoom, transaction: Y.Transaction): StepAuthor {
  const origin = transaction.origin;
  return origin instanceof LiveOrigin ? origin.author : room.me;
}

function mapAuthor(room: LiveRoom, client: number, author: StepAuthor) {
  const key = authorKey(author);
  room.users.setUserMapping(room.doc, client, key, {
    filter: (transaction) => authorKey(transactionAuthor(room, transaction)) === key,
  });
  if (!room.people.has(key)) {
    room.doc.transact(() => room.people.set(key, { ...author }), new LiveOrigin(room.me, "people"));
  }
}

function clientFor(room: LiveRoom, author: StepAuthor): number {
  const key = authorKey(author);
  if (key === authorKey(room.me)) return room.doc.clientID;
  let clients = authorClients.get(room.doc);
  if (!clients) authorClients.set(room.doc, (clients = new Map()));
  let client = clients.get(key);
  if (client === undefined) {
    client = randomClient();
    clients.set(key, client);
    mapAuthor(room, client, author);
  }
  return client;
}

function asClient(doc: Y.Doc, client: number, work: () => void) {
  const own = doc.clientID;
  if (client === own) return work();
  doc.clientID = client;
  try {
    work();
  } finally {
    doc.clientID = own;
  }
}

export function transactAs(
  room: LiveRoom,
  author: StepAuthor,
  reason: LiveOrigin["reason"],
  work: () => void,
) {
  const client = clientFor(room, author);
  asClient(room.doc, client, () => room.doc.transact(work, new LiveOrigin(author, reason)));
}

export function seedAs(room: LiveRoom, work: () => void) {
  asClient(room.doc, randomClient(), () =>
    room.doc.transact(work, new LiveOrigin(room.me, "seed")),
  );
}

export function transactAsMain(room: LiveRoom, work: () => void) {
  transactAs(room, mainAuthor, "main", work);
}

export const writerOf = (room: LiveRoom, client: number): string | null =>
  (room.users.getUserByClientId(client) as string | null) ?? null;

const rooms = new Map<string, Promise<LiveRoom>>();
const open = new Map<string, LiveRoom>();

export const openRoom = (sessionId: string): LiveRoom | undefined => open.get(sessionId);

export function acquireRoom(
  spaceId: string,
  sessionId: string,
  me: StepAuthor,
  person: Omit<LivePerson, keyof StepAuthor>,
): Promise<LiveRoom> {
  let found = rooms.get(sessionId);
  if (!found) {
    found = createRoom(spaceId, sessionId, me, person);
    rooms.set(sessionId, found);
    found.then(
      (room) => open.set(sessionId, room),
      () => rooms.delete(sessionId),
    );
  }
  return found;
}

export function closeRoom(sessionId: string) {
  const room = open.get(sessionId);
  rooms.delete(sessionId);
  open.delete(sessionId);
  if (!room) return;
  room.awareness.setLocalState(null);
  room.live.destroy();
}

async function createRoom(
  spaceId: string,
  sessionId: string,
  me: StepAuthor,
  person: Omit<LivePerson, keyof StepAuthor>,
): Promise<LiveRoom> {
  const misty = await spacesGateway.get().pageMisty(spaceId, "code");
  const live = misty.room(sessionId, { gc: false });
  const doc = live.doc;
  const access = liveAccess(live);
  let ready = false;
  const room: LiveRoom = {
    sessionId,
    spaceId,
    doc,
    files: doc.getMap<Y.Text>("files"),
    steps: doc.getArray<LiveStep>("steps"),
    people: doc.getMap<LivePerson>("people"),
    users: new Y.PermanentUserData(doc),
    live,
    awareness: live.awareness,
    access,
    me,
    ready: Promise.resolve(),
    isReady: () => ready,
  };
  const tone = useCursorTone.getState().value;
  const color = tone === "auto" ? personColor(me.id) : `var(--color-tone-${tone})`;
  if (useShowInLive.getState().value)
    live.awareness.setLocalStateField("user", {
      id: me.id,
      name: me.name,
      color,
      colorLight: `color-mix(in srgb, ${color} 24%, transparent)`,
    });
  room.ready = synced(live, access).then(() => {
    mapAuthor(room, doc.clientID, me);
    doc.transact(
      () => room.people.set(authorKey(me), { ...me, ...person }),
      new LiveOrigin(me, "people"),
    );
    ready = true;
  });
  return room;
}

function liveAccess(live: Room): LiveAccess {
  return {
    get lost() {
      const code = live.lost?.code;
      return code === "not_found" ? "deleted" : code === "permission_denied" ? "revoked" : null;
    },
    subscribe: (listener) => live.onLost(() => listener()),
  };
}

const joinTimeoutMs = 30_000;

function synced(live: Room, access: LiveAccess): Promise<void> {
  return new Promise((resolve, reject) => {
    const lostError = () =>
      new Error(
        access.lost === "deleted"
          ? "This session ended."
          : access.lost === "revoked"
            ? "You no longer have access to this session."
            : "Couldn't reach the live session. Check your connection and try again.",
      );
    const timer = window.setTimeout(
      () =>
        reject(new Error("Couldn't reach the live session. Check your connection and try again.")),
      joinTimeoutMs,
    );
    live.synced.then(
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      () => {
        window.clearTimeout(timer);
        reject(lostError());
      },
    );
  });
}
