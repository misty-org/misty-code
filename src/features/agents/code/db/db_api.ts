import { invoke } from "@/native/invoke";
import { agentAccountId } from "../../personal/agent_account";

export type DbKind = "sqlite" | "postgres";
export type SslMode = "disable" | "prefer" | "require";

export interface SqliteTarget {
  path: string;
}

export interface PostgresTarget {
  host: string;
  port: number;
  database: string;
  user: string;
  sslMode: SslMode;
}

export interface DbConnection {
  id: string;
  name: string;
  kind: DbKind;
  sqlite?: SqliteTarget | null;
  postgres?: PostgresTarget | null;
}

export interface SavedConnection extends DbConnection {
  hasPassword: boolean;
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface SchemaTable {
  name: string;
  kind: "table" | "view";
  columns: SchemaColumn[];
}

export interface SchemaGroup {
  name: string;
  tables: SchemaTable[];
}

export interface DbSchema {
  schemas: SchemaGroup[];
}

export type CellValue =
  string | number | boolean | null | CellValue[] | { [key: string]: CellValue };

export interface QueryResult {
  columns: { name: string; type: string }[];
  rows: CellValue[][];
  rowsAffected: number;
  elapsedMs: number;
  truncated: boolean;
}

export interface TableRef {
  schema: string;
  name: string;
}

const account = () => agentAccountId();

export const dbApi = {
  list: () => invoke<SavedConnection[]>("code_db_list", { account: account() }),
  save: (connection: DbConnection, password?: string) =>
    invoke<SavedConnection>("code_db_save", { account: account(), connection, password }),
  remove: (id: string) => invoke<void>("code_db_remove", { account: account(), id }),
  test: (connection: DbConnection, password?: string) =>
    invoke<void>("code_db_test", { account: account(), connection, password }),
  pickSqlite: () => invoke<string | null>("code_db_pick_sqlite", { account: account() }),
  schema: (id: string) => invoke<DbSchema>("code_db_schema", { account: account(), id }),
  query: (id: string, sql: string, limit: number, queryId: string) =>
    invoke<QueryResult>("code_db_query", { account: account(), id, sql, limit, queryId }),
  cancel: (queryId: string) => invoke<void>("code_db_cancel", { account: account(), queryId }),
  updateRow: (
    id: string,
    table: TableRef,
    key: Record<string, CellValue>,
    changes: Record<string, CellValue>,
  ) => invoke<void>("code_db_update_row", { account: account(), id, table, key, changes }),
};

export const errorText = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);
