import { errorText } from "../../context-panel/projectApi";
import type { LspLanguage } from "./languages";
import { lspApi } from "./lspApi";
import { useLspStore } from "./lspStore";

const pending = new Map<LspLanguage, Promise<void>>();

async function installIfMissing(language: LspLanguage): Promise<void> {
  const { setInstall } = useLspStore.getState();
  setInstall(language, { phase: "checking" });
  try {
    const status = await lspApi.status(language);
    if (status.installed) {
      setInstall(language, { phase: "ready", version: status.version ?? undefined });
      return;
    }
    if (status.problem) throw new Error(status.problem);
    setInstall(language, { phase: "installing" });
    const installed = await lspApi.install(language);
    setInstall(language, { phase: "ready", version: installed.version ?? undefined });
  } catch (error) {
    setInstall(language, { phase: "failed", error: errorText(error) });
    throw error;
  }
}

export function ensureInstalled(language: LspLanguage): Promise<void> {
  const known = pending.get(language);
  if (known) return known;
  const run = installIfMissing(language);
  pending.set(language, run);
  run.catch(() => {
    if (pending.get(language) === run) pending.delete(language);
  });
  return run;
}

export function retryLanguageServers(): void {
  pending.clear();
  useLspStore.getState().retry();
}
