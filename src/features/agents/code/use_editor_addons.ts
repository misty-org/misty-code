import type { Extension } from "@codemirror/state";
import { useMemo } from "react";
import { modernEditor } from "@/shared/lib/codemirror/editor_modern";
import {
  editorFontExtension,
  editorPageThemeExtension,
} from "@/shared/lib/codemirror/editor_themes";
import { useEditorFont, useEditorTheme } from "./editor_appearance";
import { useStatusAddon } from "./code_status";
import { noAddon, type EditorAddon, type EditorAddonContext } from "./editor_addons";
import { useGitAddon } from "./git/git_addon";
import { useLiveAddon } from "./live";
import { useLspAddon } from "./lsp";
import { useVimAddon } from "./vim/vim_addon";

function useThemeAddon(ctx: EditorAddonContext): EditorAddon {
  const theme = useEditorTheme((state) => state.value);
  const font = useEditorFont((state) => state.value);
  const page = ctx.appearance === "page";
  return useMemo(
    () =>
      page
        ? {
            extensions: [editorPageThemeExtension(theme), editorFontExtension(font), modernEditor],
          }
        : noAddon,
    [page, theme, font],
  );
}

export function useEditorAddons(ctx: EditorAddonContext): EditorAddon {
  const theme = useThemeAddon(ctx);
  const vim = useVimAddon(ctx);
  const status = useStatusAddon(ctx);
  const live = useLiveAddon(ctx);
  const git = useGitAddon(ctx, { live: Boolean(live.savesItself) });
  const lsp = useLspAddon(ctx);
  return useMemo(() => {
    const addons = [theme, vim, status, git, lsp, live];
    const extensions: Extension[] = addons.flatMap((addon) => [...addon.extensions]);
    return {
      extensions,
      document: addons.find((addon) => addon.document)?.document,
      savesItself: addons.some((addon) => addon.savesItself),
    };
  }, [theme, vim, status, git, lsp, live]);
}
