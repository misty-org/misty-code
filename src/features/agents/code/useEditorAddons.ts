import type { Extension } from "@codemirror/state";
import { useMemo } from "react";
import { modernEditor } from "@/shared/lib/codemirror/editorModern";
import {
  editorFontExtension,
  editorPageThemeExtension,
} from "@/shared/lib/codemirror/editorThemes";
import { useEditorFont, useEditorTheme } from "./editorAppearance";
import { useStatusAddon } from "./codeStatus";
import { noAddon, type EditorAddon, type EditorAddonContext } from "./editorAddons";
import { useGitAddon } from "./git/gitAddon";
import { useLiveAddon } from "./live";
import { useLspAddon } from "./lsp";
import { useVimAddon } from "./vim/vimAddon";

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
