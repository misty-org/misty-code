import {
  LSPClient,
  hoverTooltips,
  jumpToDefinition,
  jumpToDefinitionKeymap,
  serverCompletion,
  serverDiagnostics,
  type LSPClientExtension,
} from "@codemirror/lsp-client";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { LspLanguage } from "./languages";
import {
  LSP_CLOSED_EVENT,
  LSP_MESSAGE_EVENT,
  LSP_PROGRESS_EVENT,
  lspApi,
  type LspClosed,
  type LspMessage,
  type LspProgress,
  type LspStarted,
} from "./lspApi";
import { useLspStore } from "./lspStore";
import { sanitizeServerHtml } from "./sanitize";
import { ServerTransport } from "./transport";
import { CodeWorkspace } from "./workspace";

const REQUEST_TIMEOUT_MS = 15_000;
const RELEASE_DELAY_MS = 20_000;
const IS_MAC = typeof navigator !== "undefined" && navigator.platform.includes("Mac");

const PAGE =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export interface Connection {
  id: string;
  client: LSPClient;
  transport: ServerTransport;
  ready: Promise<null>;
}

const connections = new Map<string, Connection>();

const definitionClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    const mod = IS_MAC ? event.metaKey : event.ctrlKey;
    if (!mod || event.button !== 0 || event.altKey || event.shiftKey) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    event.preventDefault();
    view.dispatch({ selection: { anchor: pos } });
    return jumpToDefinition(view);
  },
});

interface ProgressValue {
  kind?: string;
  title?: string;
}

function progressExtension(serverId: string): LSPClientExtension {
  const titles = new Map<string | number, string>();
  return {
    clientCapabilities: { window: { workDoneProgress: true } },
    notificationHandlers: {
      "$/progress": (_client, params: { token?: string | number; value?: ProgressValue }) => {
        const token = params?.token;
        const value = params?.value;
        if (token === undefined || !value) return true;
        if (value.kind === "begin" && value.title) titles.set(token, value.title);
        if (value.kind === "end") titles.delete(token);
        const latest = Array.from(titles.values()).pop() ?? null;
        useLspStore.getState().setActivity(serverId, latest);
        return true;
      },
    },
  };
}

function clientExtensions(serverId: string): readonly (Extension | LSPClientExtension)[] {
  return [
    serverCompletion(),
    hoverTooltips(),
    serverDiagnostics(),
    keymap.of(jumpToDefinitionKeymap),
    definitionClick,
    progressExtension(serverId),
  ];
}

function forget(id: string): void {
  const connection = connections.get(id);
  if (!connection) return;
  connections.delete(id);
  connection.transport.close();
  connection.client.disconnect();
  useLspStore.getState().setActivity(id, null);
}

function serverClosed({ id, message }: LspClosed): void {
  forget(id);
  useLspStore.getState().serverClosed(id, message ?? "The language server stopped.");
}

let listening: Promise<void> | null = null;

function ensureListening(): Promise<void> {
  if (!listening) {
    const webview = getCurrentWebview();
    const subscribed = Promise.all([
      webview.listen<LspMessage>(LSP_MESSAGE_EVENT, ({ payload }) =>
        connections.get(payload.id)?.transport.receive(payload.message),
      ),
      webview.listen<LspClosed>(LSP_CLOSED_EVENT, ({ payload }) => serverClosed(payload)),
      webview.listen<LspProgress>(LSP_PROGRESS_EVENT, ({ payload }) =>
        useLspStore.getState().setProgress(payload),
      ),
    ]).then(() => undefined);
    listening = subscribed;
    subscribed.catch(() => {
      if (listening === subscribed) listening = null;
    });
  }
  return listening;
}

function connect(started: LspStarted, root: string): Connection {
  const known = connections.get(started.id);
  if (known) return known;
  const transport = new ServerTransport(started.id, started.rootUri);
  const place = { root, folderUri: started.folderUri };
  const client = new LSPClient({
    rootUri: started.rootUri,
    timeout: REQUEST_TIMEOUT_MS,
    sanitizeHTML: sanitizeServerHtml,
    workspace: (owner) => new CodeWorkspace(owner, place),
    extensions: clientExtensions(started.id),
  });
  client.connect(transport);
  const ready = client.initializing;
  ready.catch(() => undefined);
  const connection: Connection = { id: started.id, client, transport, ready };
  connections.set(started.id, connection);
  return connection;
}

export interface ServerLease {
  connection: Connection;
  fileUri: string;
  release(): void;
}

function stop(id: string): void {
  lspApi.stop(id).then(
    (ended) => {
      if (ended) forget(id);
    },
    () => forget(id),
  );
}

export async function openServer(
  language: LspLanguage,
  root: string,
  path: string,
): Promise<ServerLease> {
  await ensureListening();
  const started = await lspApi.start(language, root, path, PAGE);
  const connection = connect(started, root);
  let released = false;
  return {
    connection,
    fileUri: started.fileUri,
    release: () => {
      if (released) return;
      released = true;
      setTimeout(() => stop(started.id), RELEASE_DELAY_MS);
    },
  };
}
