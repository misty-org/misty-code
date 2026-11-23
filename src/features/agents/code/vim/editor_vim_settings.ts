import { createDeviceSetting } from "@/shared/lib/device_setting";

export const useEditorVim = createDeviceSetting<boolean>({
  scope: "editor-vim",
  defaults: false,
  normalize: (stored) => stored === true,
});

export const useEditorNvimMappings = createDeviceSetting<boolean>({
  scope: "editor-nvim-mappings",
  defaults: true,
  normalize: (stored) => stored !== false,
});

export { useEditorWordWrap } from "@/features/agents/context-panel/editor/editor_settings";
