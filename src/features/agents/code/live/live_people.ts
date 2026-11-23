import { useMemo } from "react";
import type { LiveRoom } from "./live_room";
import { useRoomVersion } from "./live_store";
import type { LiveAwareness, LivePerson, LiveStep } from "./live_types";

export interface PresentPerson {
  id: string;
  name: string;
  path: string | null;
}

export function presentPeople(room: LiveRoom, withMe: boolean): PresentPerson[] {
  const seen = new Map<string, PresentPerson>();
  room.awareness.getStates().forEach((raw, client) => {
    const state = raw as LiveAwareness;
    const user = state.user;
    if (!user?.id || (!withMe && user.id === room.me.id)) return;
    const mine = client === room.doc.clientID;
    if (!seen.has(user.id) || mine)
      seen.set(user.id, { id: user.id, name: user.name, path: state.path ?? null });
  });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function useRoomView(room: LiveRoom | undefined) {
  const version = useRoomVersion(room);
  return useMemo(() => {
    if (!room)
      return {
        steps: [] as LiveStep[],
        people: [] as LivePerson[],
        present: [] as PresentPerson[],
      };
    return {
      steps: room.steps.toArray(),
      people: [...room.people.values()],
      present: presentPeople(room, true),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the doc's changes
  }, [room, version]);
}
