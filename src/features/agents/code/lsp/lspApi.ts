import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agentAccount";
import type { LspLanguage } from "./languages";

export const LSP_MESSAGE_EVENT = "misty://code-lsp-message";
export const LSP_CLOSED_EVENT = "misty://code-lsp-closed";
export const LSP_PROGRESS_EVENT = "misty://code-lsp-progress";

export interface LspMessage {
  id: string;
  message: string;
}

export interface LspClosed {
  id: string;
  message: string | null;
}

export type LspInstallStep = "node" | "download" | "install";

export interface LspProgress {
  language: LspLanguage;
  step: LspInstallStep;
  received: number;
  total: number | null;
}

export interface LspStatus {
  language: LspLanguage;
  server: string;
  installed: boolean;
  version: string | null;
  problem: string | null;
}

export interface LspStarted {
  id: string;
  rootUri: string;
  fileUri: string;
  folderUri: string;
}

export const lspApi = {
  status: (language: LspLanguage) =>
    invoke<LspStatus>("code_lsp_status", { account: agentAccountId(), language }),
  install: (language: LspLanguage) =>
    invoke<LspStatus>("code_lsp_install", { account: agentAccountId(), language }),
  start: (language: LspLanguage, folder: string, file: string, page: string) =>
    invoke<LspStarted>("code_lsp_start", {
      account: agentAccountId(),
      language,
      folder,
      file,
      page,
    }),
  send: (id: string, messages: string[]) => invoke<void>("code_lsp_send", { id, messages }),
  stop: (id: string) => invoke<boolean>("code_lsp_stop", { id }),
};
