import type { Transport } from "@codemirror/lsp-client";
import { lspApi } from "./lsp_api";

function localResult(method: string, params: unknown, rootUri: string): { result: unknown } | null {
  switch (method) {
    case "workspace/configuration": {
      const items = (params as { items?: unknown } | null)?.items;
      return { result: Array.isArray(items) ? items.map(() => null) : [] };
    }
    case "workspace/workspaceFolders": {
      const name = decodeURIComponent(rootUri.slice(rootUri.lastIndexOf("/") + 1)) || rootUri;
      return { result: [{ uri: rootUri, name }] };
    }
    case "workspace/applyEdit":
      return { result: { applied: false } };
    case "client/registerCapability":
    case "client/unregisterCapability":
    case "window/workDoneProgress/create":
    case "window/showMessageRequest":
    case "workspace/codeLens/refresh":
    case "workspace/semanticTokens/refresh":
    case "workspace/inlayHint/refresh":
    case "workspace/inlineValue/refresh":
    case "workspace/diagnostic/refresh":
      return { result: null };
    default:
      return null;
  }
}

function localAnswer(message: string, rootUri: string): string | null {
  if (!message.includes('"method"') || !message.includes('"id"')) return null;
  let value: { id?: unknown; method?: unknown; params?: unknown };
  try {
    value = JSON.parse(message) as typeof value;
  } catch {
    return null;
  }
  if (value.id === undefined || value.id === null || typeof value.method !== "string") return null;
  const answer = localResult(value.method, value.params, rootUri);
  return answer ? JSON.stringify({ jsonrpc: "2.0", id: value.id, ...answer }) : null;
}

export class ServerTransport implements Transport {
  private readonly id: string;
  private readonly rootUri: string;
  private readonly handlers = new Set<(message: string) => void>();
  private queue: string[] = [];
  private sending = false;
  private closed = false;

  constructor(id: string, rootUri: string) {
    this.id = id;
    this.rootUri = rootUri;
  }

  send(message: string): void {
    if (this.closed) throw new Error("The language server has stopped.");
    this.queue.push(message);
    this.flush();
  }

  subscribe(handler: (message: string) => void): void {
    this.handlers.add(handler);
  }

  unsubscribe(handler: (message: string) => void): void {
    this.handlers.delete(handler);
  }

  receive(message: string): void {
    if (this.closed) return;
    const answer = localAnswer(message, this.rootUri);
    if (answer) {
      this.queue.push(answer);
      this.flush();
      return;
    }
    for (const handler of this.handlers) handler(message);
  }

  close(): void {
    this.closed = true;
    this.queue = [];
    this.handlers.clear();
  }

  private flush(): void {
    if (this.sending || this.closed || this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    this.sending = true;
    void lspApi
      .send(this.id, batch)
      .catch(() => undefined)
      .finally(() => {
        this.sending = false;
        this.flush();
      });
  }
}
