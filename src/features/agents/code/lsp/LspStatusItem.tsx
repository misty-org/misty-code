import type { ReactNode } from "react";
import { Button, Spinner, Text, Tooltip } from "@misty/ui";
import { retryLanguageServers } from "./install";
import { lspFileKind, serverNames } from "./languages";
import type { LspInstallState } from "./lsp_store";
import { useLspStore } from "./lsp_store";

function installLabel(server: string, progress: LspInstallState["progress"]): string {
  const percent =
    progress?.total && progress.total > 0
      ? ` ${Math.min(100, Math.floor((progress.received * 100) / progress.total))}%`
      : "";
  if (progress?.step === "node") return `Getting Node.js${percent}`;
  return `Installing ${server}${percent}`;
}

function Busy({ label }: { label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Spinner size="sm" label={false} />
      <Text size="control" tone="muted">
        {label}
      </Text>
    </span>
  );
}

function Failed({ error }: { error: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2" role="alert">
      <Text size="control" tone="failed" full>
        {error}
      </Text>
      <Button variant="quiet" onClick={retryLanguageServers}>
        Try again
      </Button>
    </span>
  );
}

export function LspStatusItem({ path, root }: { path: string | null; root: string }): ReactNode {
  const kind = path && root ? lspFileKind(path) : null;
  const language = kind?.language ?? null;
  const install = useLspStore((state) => (language ? state.installs[language] : undefined));
  const file = useLspStore((state) => (path ? state.files[path] : undefined));
  const serverId = file?.serverId;
  const activity = useLspStore((state) => (serverId ? state.activity[serverId] : undefined));
  if (!kind || !language || !file) return null;
  const server = serverNames[language];
  if (install?.phase === "installing")
    return <Busy label={installLabel(server, install.progress)} />;
  if (file.phase === "failed" || install?.phase === "failed") {
    const error = (file.phase === "failed" ? file.error : install?.error) ?? `${server} stopped.`;
    return <Failed error={error} />;
  }
  if (file.phase !== "ready") return <Busy label={`Starting ${server}`} />;
  if (activity) return <Busy label={`${server}: ${activity}`} />;
  const version = install?.version;
  return (
    <Tooltip content={version ? `${server} ${version}` : server}>
      <span className="flex min-w-0 items-center">
        <Text size="control" tone="muted">
          {server}
        </Text>
      </span>
    </Tooltip>
  );
}
