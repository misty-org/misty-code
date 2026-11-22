export type LspLanguage = "typescript" | "python" | "rust" | "go";

export interface LspFileKind {
  language: LspLanguage;
  languageId: string;
}

const byExtension: Record<string, LspFileKind> = {
  ts: { language: "typescript", languageId: "typescript" },
  mts: { language: "typescript", languageId: "typescript" },
  cts: { language: "typescript", languageId: "typescript" },
  tsx: { language: "typescript", languageId: "typescriptreact" },
  js: { language: "typescript", languageId: "javascript" },
  mjs: { language: "typescript", languageId: "javascript" },
  cjs: { language: "typescript", languageId: "javascript" },
  jsx: { language: "typescript", languageId: "javascriptreact" },
  py: { language: "python", languageId: "python" },
  pyi: { language: "python", languageId: "python" },
  rs: { language: "rust", languageId: "rust" },
  go: { language: "go", languageId: "go" },
};

export function lspFileKind(path: string): LspFileKind | null {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return byExtension[name.slice(dot + 1).toLowerCase()] ?? null;
}

export const serverNames: Record<LspLanguage, string> = {
  typescript: "typescript-language-server",
  python: "basedpyright",
  rust: "rust-analyzer",
  go: "gopls",
};

export function languageName(kind: LspFileKind): string {
  switch (kind.languageId) {
    case "javascript":
    case "javascriptreact":
      return "JavaScript";
    case "typescript":
    case "typescriptreact":
      return "TypeScript";
    case "python":
      return "Python";
    case "rust":
      return "Rust";
    default:
      return "Go";
  }
}
