import { create } from "zustand";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

export type CodeActivity = "sessions" | "files" | "search" | "changes" | "live" | "databases";

const activities: readonly CodeActivity[] = [
  "sessions",
  "files",
  "search",
  "changes",
  "live",
  "databases",
];

export interface CodePageLayout {
  activity: CodeActivity;
  sidebarOpen: boolean;
  terminalOpen: boolean;
  sidebarSize: number;
  terminalSize: number;
  lastProject: string;
  chat: string;
  chatSize: number;
}

const defaults: CodePageLayout = {
  activity: "sessions",
  sidebarOpen: true,
  terminalOpen: false,
  sidebarSize: 22,
  terminalSize: 30,
  lastProject: "",
  chat: "",
  chatSize: 40,
};

const clamp = (value: unknown, low: number, high: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(high, Math.max(low, value))
    : fallback;

export const useCodePageLayout = createDeviceSetting<CodePageLayout>({
  scope: "code-page-layout",
  defaults,
  normalize: (stored) => {
    const saved = (stored ?? {}) as Partial<CodePageLayout>;
    return {
      activity: activities.includes(saved.activity as CodeActivity)
        ? (saved.activity as CodeActivity)
        : defaults.activity,
      sidebarOpen: saved.sidebarOpen !== false,
      terminalOpen: saved.terminalOpen === true,
      sidebarSize: clamp(saved.sidebarSize, 12, 50, defaults.sidebarSize),
      terminalSize: clamp(saved.terminalSize, 10, 80, defaults.terminalSize),
      lastProject: typeof saved.lastProject === "string" ? saved.lastProject : "",
      chat: typeof saved.chat === "string" ? saved.chat : "",
      chatSize: clamp(saved.chatSize, 20, 70, defaults.chatSize),
    };
  },
});

export function updateCodePageLayout(patch: Partial<CodePageLayout>) {
  const current = useCodePageLayout.getState().value;
  useCodePageLayout.getState().set({ ...current, ...patch });
}

export const useCodePageShown = create<{ count: number }>(() => ({ count: 0 }));

export const isCodePageShown = () => useCodePageShown.getState().count > 0;

export const fileRoute = () => (isCodePageShown() ? "/agents?view=code" : "/agents");
