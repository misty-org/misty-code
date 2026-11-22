import { LiveEndFlow } from "./LiveEndFlow";
import { runningSession } from "./liveSession";
import { activeJoin, useLiveStore } from "./liveStore";
import { LiveStepView } from "./LiveStepView";

function useMainView() {
  const join = useLiveStore((state) => activeJoin(state.joins));
  const open = useLiveStore((state) => (join ? state.rooms[join.sessionId] === "ready" : false));
  const ending = useLiveStore((state) => state.ending);
  const stepId = useLiveStore((state) => state.selectedStep);
  const running = join && open ? runningSession(join.sessionId) : undefined;
  if (!join || !running) return null;
  if (ending && join.startedById === running.room.me.id) return { kind: "end" as const, join };
  if (stepId && running.room.steps.toArray().some((step) => step.id === stepId))
    return { kind: "step" as const, running, stepId };
  return null;
}

export function useLiveMainShown(): boolean {
  return useMainView() !== null;
}

export function LiveMain() {
  const view = useMainView();
  if (!view) return null;
  if (view.kind === "end") return <LiveEndFlow join={view.join} />;
  return (
    <LiveStepView room={view.running.room} recorder={view.running.recorder} stepId={view.stepId} />
  );
}
