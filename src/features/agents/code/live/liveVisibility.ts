import { createDeviceSetting } from "@/shared/lib/deviceSetting";

export const useShowInLive = createDeviceSetting<boolean>({
  scope: "live-show-me",
  defaults: true,
  normalize: (stored) => stored !== false,
});

export const cursorTones = ["blue", "green", "orange", "violet", "pink", "amber", "teal"] as const;
export type CursorTone = (typeof cursorTones)[number];

export const useCursorTone = createDeviceSetting<CursorTone | "auto">({
  scope: "live-cursor-tone",
  defaults: "auto",
  normalize: (stored) =>
    typeof stored === "string" && (cursorTones as readonly string[]).includes(stored)
      ? (stored as CursorTone)
      : "auto",
});
