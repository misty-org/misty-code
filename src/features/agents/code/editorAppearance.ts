import { editorFonts, editorThemes } from "@/shared/lib/codemirror/editorThemes";
import { createDeviceSetting } from "@/shared/lib/deviceSetting";

export const useEditorTheme = createDeviceSetting<string>({
  scope: "editor-theme",
  defaults: "misty",
  normalize: (stored) =>
    typeof stored === "string" && editorThemes.some((theme) => theme.value === stored)
      ? stored
      : "misty",
});

export const useEditorFont = createDeviceSetting<string>({
  scope: "editor-font",
  defaults: "jetbrains-mono",
  normalize: (stored) =>
    typeof stored === "string" && editorFonts.some((font) => font.value === stored)
      ? stored
      : "jetbrains-mono",
});
