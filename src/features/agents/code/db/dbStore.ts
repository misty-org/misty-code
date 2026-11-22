import { create } from "zustand";
import {
  dbApi,
  errorText,
  type CellValue,
  type DbConnection,
  type DbSchema,
  type QueryResult,
  type SavedConnection,
  type SchemaTable,
  type TableRef,
} from "./dbApi";
import { ROW_LIMIT, selectTable } from "./sqlText";

export interface SchemaState {
  schema: DbSchema | null;
  error: string | null;
  loading: boolean;
}

export interface DbTab {
  id: string;
  connectionId: string;
  kind: "table" | "query";
  title: string;
  table: TableRef | null;
  sql: string;
  result: QueryResult | null;
  error: string | null;
  runId: string | null;
  edits: Record<number, Record<string, CellValue>>;
}

export interface DbState {
  connections: SavedConnection[] | null;
  listError: string | null;
  schemas: Record<string, SchemaState>;
  expanded: Record<string, true>;
  selected: string | null;
  tabs: DbTab[];
  activeTab: string | null;

  loadConnections(): Promise<void>;
  saveConnection(connection: DbConnection, password?: string): Promise<SavedConnection>;
  removeConnection(id: string): Promise<void>;
  toggleConnection(id: string): void;
  toggleSchema(id: string, schema: string): void;
  loadSchema(id: string): Promise<void>;
  openTable(id: string, schema: string, table: SchemaTable): void;
  newQuery(id: string): void;
  selectTab(id: string): void;
  closeTab(id: string): void;
  setSql(tab: string, sql: string): void;
  run(tab: string): Promise<void>;
  stop(tab: string): void;
  editCell(tab: string, row: number, column: string, value: CellValue): void;
  revertCell(tab: string, row: number, column: string): void;
  discardEdits(tab: string): void;
  saveEdits(tab: string): Promise<void>;
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const same = (left: CellValue, right: CellValue) =>
  left === right || JSON.stringify(left) === JSON.stringify(right);

let queryCount = 0;

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export const useDbStore = create<DbState>((set, get) => {
  const patchTab = (id: string, patch: Partial<DbTab> | ((tab: DbTab) => Partial<DbTab>)) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, ...(typeof patch === "function" ? patch(tab) : patch) } : tab,
      ),
    }));
  const tabOf = (id: string) => get().tabs.find((tab) => tab.id === id);

  return {
    connections: null,
    listError: null,
    schemas: {},
    expanded: {},
    selected: null,
    tabs: [],
    activeTab: null,

    async loadConnections() {
      set({ listError: null });
      try {
        set({ connections: await dbApi.list() });
      } catch (error) {
        set({ listError: errorText(error) });
      }
    },

    async saveConnection(connection, password) {
      const saved = await dbApi.save(connection, password);
      set((state) => {
        const list = state.connections ?? [];
        const known = list.some((item) => item.id === saved.id);
        return {
          connections: known
            ? list.map((item) => (item.id === saved.id ? saved : item))
            : [...list, saved],
          schemas: without(state.schemas, saved.id),
          selected: saved.id,
        };
      });
      if (get().expanded[`c:${saved.id}`]) void get().loadSchema(saved.id);
      return saved;
    },

    async removeConnection(id) {
      await dbApi.remove(id);
      set((state) => {
        const tabs = state.tabs.filter((tab) => tab.connectionId !== id);
        return {
          connections: (state.connections ?? []).filter((item) => item.id !== id),
          schemas: without(state.schemas, id),
          tabs,
          activeTab: tabs.some((tab) => tab.id === state.activeTab)
            ? state.activeTab
            : (tabs[tabs.length - 1]?.id ?? null),
          selected: state.selected === id ? null : state.selected,
        };
      });
    },

    toggleConnection(id) {
      const key = `c:${id}`;
      const open = Boolean(get().expanded[key]);
      set((state) => {
        const expanded = { ...state.expanded };
        if (open) delete expanded[key];
        else expanded[key] = true;
        return { expanded, selected: id };
      });
      const loaded = get().schemas[id];
      if (!open && (!loaded || (!loaded.schema && !loaded.loading))) void get().loadSchema(id);
    },

    toggleSchema(id, schema) {
      const key = `s:${id}:${schema}`;
      set((state) => {
        const expanded = { ...state.expanded };
        if (expanded[key]) delete expanded[key];
        else expanded[key] = true;
        return { expanded };
      });
    },

    async loadSchema(id) {
      set((state) => ({
        schemas: {
          ...state.schemas,
          [id]: { schema: state.schemas[id]?.schema ?? null, error: null, loading: true },
        },
      }));
      let next: SchemaState;
      try {
        const schema = await dbApi.schema(id);
        next = { schema, error: null, loading: false };
        if (schema.schemas.length === 1) {
          const key = `s:${id}:${schema.schemas[0].name}`;
          set((state) => ({ expanded: { ...state.expanded, [key]: true } }));
        }
      } catch (error) {
        next = {
          schema: get().schemas[id]?.schema ?? null,
          error: errorText(error),
          loading: false,
        };
      }
      set((state) => ({ schemas: { ...state.schemas, [id]: next } }));
    },

    openTable(id, schema, table) {
      const existing = get().tabs.find(
        (tab) =>
          tab.connectionId === id &&
          tab.kind === "table" &&
          tab.table?.schema === schema &&
          tab.table.name === table.name,
      );
      if (existing) {
        set({ activeTab: existing.id, selected: id });
        return;
      }
      const ref = { schema, name: table.name };
      const tab: DbTab = {
        id: newId(),
        connectionId: id,
        kind: "table",
        title: table.name,
        table: ref,
        sql: selectTable(ref),
        result: null,
        error: null,
        runId: null,
        edits: {},
      };
      set((state) => ({ tabs: [...state.tabs, tab], activeTab: tab.id, selected: id }));
      void get().run(tab.id);
    },

    newQuery(id) {
      queryCount += 1;
      const tab: DbTab = {
        id: newId(),
        connectionId: id,
        kind: "query",
        title: queryCount === 1 ? "Query" : `Query ${queryCount}`,
        table: null,
        sql: "",
        result: null,
        error: null,
        runId: null,
        edits: {},
      };
      set((state) => ({ tabs: [...state.tabs, tab], activeTab: tab.id, selected: id }));
    },

    selectTab(id) {
      const tab = tabOf(id);
      set({ activeTab: id, selected: tab?.connectionId ?? get().selected });
    },

    closeTab(id) {
      const tab = tabOf(id);
      if (tab?.runId) void dbApi.cancel(tab.runId).catch(() => undefined);
      set((state) => {
        const index = state.tabs.findIndex((item) => item.id === id);
        const tabs = state.tabs.filter((item) => item.id !== id);
        const activeTab =
          state.activeTab === id
            ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null)
            : state.activeTab;
        return { tabs, activeTab };
      });
    },

    setSql(tab, sql) {
      patchTab(tab, { sql });
    },

    async run(id) {
      const tab = tabOf(id);
      if (!tab || tab.runId || !tab.sql.trim()) return;
      const runId = newId();
      patchTab(id, { runId, error: null });
      try {
        const result = await dbApi.query(tab.connectionId, tab.sql, ROW_LIMIT, runId);
        patchTab(id, (current) =>
          current.runId === runId ? { result, runId: null, edits: {} } : {},
        );
      } catch (error) {
        patchTab(id, (current) =>
          current.runId === runId ? { error: errorText(error), runId: null } : {},
        );
      }
    },

    stop(id) {
      const runId = tabOf(id)?.runId;
      if (runId) void dbApi.cancel(runId).catch(() => undefined);
    },

    editCell(id, row, column, value) {
      patchTab(id, (tab) => {
        const index = tab.result?.columns.findIndex((item) => item.name === column) ?? -1;
        const original = index < 0 ? undefined : tab.result?.rows[row]?.[index];
        const rowEdits = { ...tab.edits[row] };
        if (original !== undefined && same(original, value)) delete rowEdits[column];
        else rowEdits[column] = value;
        const edits = { ...tab.edits };
        if (Object.keys(rowEdits).length) edits[row] = rowEdits;
        else delete edits[row];
        return { edits };
      });
    },

    revertCell(id, row, column) {
      patchTab(id, (tab) => {
        const rowEdits = { ...tab.edits[row] };
        delete rowEdits[column];
        const edits = { ...tab.edits };
        if (Object.keys(rowEdits).length) edits[row] = rowEdits;
        else delete edits[row];
        return { edits };
      });
    },

    discardEdits(id) {
      patchTab(id, { edits: {} });
    },

    async saveEdits(id) {
      const tab = tabOf(id);
      if (!tab?.table || !tab.result) return;
      const keyColumns = primaryKeyOf(get(), tab);
      for (const [rowText, changes] of Object.entries(tab.edits)) {
        const row = Number(rowText);
        const key = rowKey(tab.result, row, keyColumns);
        await dbApi.updateRow(tab.connectionId, tab.table, key, changes);
        patchTab(id, (current) => {
          const edits = { ...current.edits };
          delete edits[row];
          const rows = current.result?.rows.map((cells, index) =>
            index === row
              ? cells.map((cell, column) => {
                  const name = current.result!.columns[column].name;
                  return name in changes ? changes[name] : cell;
                })
              : cells,
          );
          return {
            edits,
            result: current.result && rows ? { ...current.result, rows } : current.result,
          };
        });
      }
      await get().run(id);
    },
  };
});

export function tableOf(state: Pick<DbState, "schemas">, tab: DbTab): SchemaTable | null {
  if (!tab.table) return null;
  const group = state.schemas[tab.connectionId]?.schema?.schemas.find(
    (item) => item.name === tab.table!.schema,
  );
  return group?.tables.find((item) => item.name === tab.table!.name) ?? null;
}

export function primaryKeyOf(state: Pick<DbState, "schemas">, tab: DbTab): string[] {
  const table = tableOf(state, tab);
  if (!table || table.kind !== "table" || !tab.result) return [];
  const key = table.columns.filter((column) => column.primaryKey).map((column) => column.name);
  const shown = new Set(tab.result.columns.map((column) => column.name));
  return key.every((name) => shown.has(name)) ? key : [];
}

export function rowKey(result: QueryResult, row: number, keyColumns: string[]) {
  const key: Record<string, CellValue> = {};
  for (const name of keyColumns) {
    const column = result.columns.findIndex((item) => item.name === name);
    key[name] = result.rows[row]?.[column] ?? null;
  }
  return key;
}
