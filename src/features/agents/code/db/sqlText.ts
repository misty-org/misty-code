import type { SQLNamespace } from "@codemirror/lang-sql";
import type { CellValue, DbKind, DbSchema, TableRef } from "./dbApi";

export const ROW_LIMIT = 500;

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

export const defaultSchema = (kind: DbKind) => (kind === "postgres" ? "public" : "main");

export function tableName(table: TableRef) {
  return `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`;
}

export function selectTable(table: TableRef) {
  return `select * from ${tableName(table)} limit ${ROW_LIMIT}`;
}

export function cellText(value: CellValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function literal(value: CellValue): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${cellText(value).replace(/'/g, "''")}'`;
}

export function updateStatement(
  table: TableRef,
  key: Record<string, CellValue>,
  changes: Record<string, CellValue>,
) {
  const sets = Object.entries(changes).map(
    ([name, value]) => `${quoteIdent(name)} = ${literal(value)}`,
  );
  const wheres = Object.entries(key).map(
    ([name, value]) => `${quoteIdent(name)} = ${literal(value)}`,
  );
  return `update ${tableName(table)}\n   set ${sets.join(",\n       ")}\n where ${wheres.join("\n   and ")};`;
}

export function completionSchema(schema: DbSchema): SQLNamespace {
  const namespace: Record<string, Record<string, SQLNamespace>> = {};
  for (const group of schema.schemas) {
    const tables: Record<string, SQLNamespace> = {};
    for (const table of group.tables) {
      tables[table.name] = {
        self: { label: table.name, type: table.kind === "view" ? "type" : "class" },
        children: table.columns.map((column) => ({
          label: column.name,
          type: "property",
          detail: column.type,
        })),
      };
    }
    namespace[group.name] = tables;
  }
  return namespace;
}
