import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
  CircleX,
  GitBranch,
  Palette,
  RadioTower,
  SquareTerminal,
  TriangleAlert,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { create } from "zustand";
import { editorThemes } from "@/shared/lib/codemirror/editor_themes";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  IconButton,
  MenuRadioGroup,
  MenuRadioItem,
  Text,
  Tooltip,
} from "@misty/ui";
import { fileName, useFilesStore } from "../context-panel/files/files_store";
import { LineCounts } from "../context-panel/git/LineCounts";
import { useGitStore } from "../context-panel/git/store";
import { updateCodePageLayout, useCodePageLayout } from "./code_page_store";
import { useCodeStatus } from "./code_status";
import { useEditorTheme } from "./editor_appearance";
import { LivePresence } from "./live";
import { LspStatusItem } from "./lsp";

interface CodeBarPage {
  root: string;
  sessionName: string | null;
}

export const useCodeBar = create<{ byView: Record<string, CodeBarPage> }>(() => ({ byView: {} }));

export function useShareCodeBar(viewId: string | null, root: string, sessionName: string | null) {
  useEffect(() => {
    if (!viewId) return;
    useCodeBar.setState((state) => ({
      byView: { ...state.byView, [viewId]: { root, sessionName } },
    }));
  }, [viewId, root, sessionName]);
  useEffect(() => {
    if (!viewId) return;
    return () =>
      useCodeBar.setState((state) => {
        const { [viewId]: _gone, ...rest } = state.byView;
        return { byView: rest };
      });
  }, [viewId]);
}

export interface FocusedCodePage {
  viewId: string;
}

const usePage = (viewId: string) => useCodeBar((state) => state.byView[viewId]);

function useActiveStatus() {
  const active = useFilesStore((state) => state.activeFilePath);
  const status = useCodeStatus((state) => (active ? state.byPath[active] : undefined));
  return { active, status };
}

function BarText({ children }: { children: ReactNode }) {
  return (
    <Text
      bare
      size="control"
      tone="muted"
      className="flex h-8 flex-none items-center gap-1.5 whitespace-nowrap px-2"
    >
      {children}
    </Text>
  );
}

export function CodeVimStatus(_: FocusedCodePage) {
  const { status } = useActiveStatus();
  if (!status?.vimMode) return null;
  const mode = status.vimMode.charAt(0).toUpperCase() + status.vimMode.slice(1);
  return (
    <Text
      bare
      size="control"
      className="flex h-8 flex-none items-center whitespace-nowrap px-2"
      aria-label={`Vim mode: ${mode}`}
    >
      {mode}
    </Text>
  );
}

export function CodeBranchStatus({ viewId }: FocusedCodePage) {
  const root = usePage(viewId)?.root ?? "";
  const status = useGitStore((state) => (root ? state.statusByWorkspace[root] : undefined));
  useEffect(() => {
    if (root) void useGitStore.getState().refresh(root);
  }, [root]);
  if (!status?.branch) return null;
  return (
    <Button
      variant="quiet"
      icon={GitBranch}
      onClick={() => updateCodePageLayout({ activity: "changes", sidebarOpen: true })}
    >
      <span className="flex items-center gap-1.5">
        {status.branch}
        <LineCounts git={status} />
      </span>
    </Button>
  );
}

export function CodeLiveStatus({ viewId }: FocusedCodePage) {
  const sessionName = usePage(viewId)?.sessionName;
  if (!sessionName) return null;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Button
        variant="quiet"
        icon={RadioTower}
        onClick={() => updateCodePageLayout({ activity: "live", sidebarOpen: true })}
      >
        {sessionName}
      </Button>
      <LivePresence />
    </span>
  );
}

export function CodeProblemsStatus(_: FocusedCodePage) {
  const { status } = useActiveStatus();
  const errors = status?.errors ?? 0;
  const warnings = status?.warnings ?? 0;
  if (!errors && !warnings) return null;
  return (
    <span className="flex flex-none items-center" role="status">
      {errors ? (
        <Text
          bare
          size="control"
          tone="removed"
          className="flex h-8 items-center gap-1.5 px-2"
          aria-label={`${errors} ${errors === 1 ? "error" : "errors"}`}
        >
          <CircleX aria-hidden />
          {errors}
        </Text>
      ) : null}
      {warnings ? (
        <Text
          bare
          size="control"
          tone="changed"
          className="flex h-8 items-center gap-1.5 px-2"
          aria-label={`${warnings} ${warnings === 1 ? "warning" : "warnings"}`}
        >
          <TriangleAlert aria-hidden />
          {warnings}
        </Text>
      ) : null}
    </span>
  );
}

export function CodeCursorStatus(_: FocusedCodePage) {
  const { active, status } = useActiveStatus();
  if (!active || !status) return null;
  return <BarText>{`Ln ${status.line}, Col ${status.column}`}</BarText>;
}

export function CodeLanguageStatus(_: FocusedCodePage) {
  const active = useFilesStore((state) => state.activeFilePath);
  const language = active
    ? LanguageDescription.matchFilename(languages, fileName(active))?.name
    : undefined;
  return language ? <BarText>{language}</BarText> : null;
}

export function CodeServerStatus({ viewId }: FocusedCodePage) {
  const root = usePage(viewId)?.root ?? "";
  const active = useFilesStore((state) => state.activeFilePath);
  return (
    <span className="flex h-8 min-w-0 items-center px-2">
      <LspStatusItem path={active} root={root} />
    </span>
  );
}

export function CodeThemeStatus(_: FocusedCodePage) {
  const theme = useEditorTheme((state) => state.value);
  return (
    <DropdownMenu>
      <Tooltip content="Editor theme">
        <DropdownMenuTrigger asChild>
          <Button variant="quiet" icon={Palette}>
            {editorThemes.find((entry) => entry.value === theme)?.label ?? "Misty"}
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        <MenuRadioGroup value={theme} onValueChange={(next) => useEditorTheme.getState().set(next)}>
          {editorThemes.map((entry) => (
            <MenuRadioItem key={entry.value} value={entry.value} label={entry.label} />
          ))}
        </MenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CodeTerminalButton(_: FocusedCodePage) {
  const terminalOpen = useCodePageLayout((state) => state.value.terminalOpen);
  return (
    <IconButton
      label={terminalOpen ? "Hide the terminal" : "Show the terminal"}
      shortcut="⌃`"
      aria-pressed={terminalOpen}
      onClick={() => updateCodePageLayout({ terminalOpen: !terminalOpen })}
    >
      <SquareTerminal />
    </IconButton>
  );
}
