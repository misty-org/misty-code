#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(super) enum Language {
    TypeScript,
    Python,
    Rust,
    Go,
}

pub(super) const ALL: [Language; 4] = [
    Language::TypeScript,
    Language::Python,
    Language::Rust,
    Language::Go,
];

pub(super) const GO_MISSING: &str = "Install Go to get Go language support.";

pub(super) enum Source {
    Npm {
        packages: &'static [&'static str],
        package: &'static str,
        bin: &'static str,
    },
    GithubGz {
        repo: &'static str,
        program: &'static str,
    },
    GoInstall {
        module: &'static str,
        program: &'static str,
    },
}

impl Language {
    pub(super) fn from_id(id: &str) -> Result<Self, String> {
        ALL.into_iter()
            .find(|language| language.id() == id)
            .ok_or_else(|| "Misty has no language server for that language.".to_string())
    }

    pub(super) fn id(self) -> &'static str {
        match self {
            Language::TypeScript => "typescript",
            Language::Python => "python",
            Language::Rust => "rust",
            Language::Go => "go",
        }
    }

    pub(super) fn index(self) -> usize {
        match self {
            Language::TypeScript => 0,
            Language::Python => 1,
            Language::Rust => 2,
            Language::Go => 3,
        }
    }

    pub(super) fn server(self) -> &'static str {
        match self {
            Language::TypeScript => "typescript-language-server",
            Language::Python => "basedpyright",
            Language::Rust => "rust-analyzer",
            Language::Go => "gopls",
        }
    }

    pub(super) fn source(self) -> Source {
        match self {
            Language::TypeScript => Source::Npm {
                packages: &["typescript-language-server", "typescript"],
                package: "typescript-language-server",
                bin: "typescript-language-server",
            },
            Language::Python => Source::Npm {
                packages: &["basedpyright"],
                package: "basedpyright",
                bin: "basedpyright-langserver",
            },
            Language::Rust => Source::GithubGz {
                repo: "rust-lang/rust-analyzer",
                program: "rust-analyzer",
            },
            Language::Go => Source::GoInstall {
                module: "golang.org/x/tools/gopls",
                program: "gopls",
            },
        }
    }

    pub(super) fn args(self) -> &'static [&'static str] {
        match self {
            Language::TypeScript | Language::Python => &["--stdio"],
            Language::Rust | Language::Go => &[],
        }
    }

    pub(super) fn root_markers(self) -> &'static [&'static str] {
        match self {
            Language::TypeScript => &["tsconfig.json", "jsconfig.json", "package.json"],
            Language::Python => &[
                "pyproject.toml",
                "setup.cfg",
                "setup.py",
                "pyrightconfig.json",
            ],
            Language::Rust => &["Cargo.toml"],
            Language::Go => &["go.mod"],
        }
    }
}

pub(super) fn program_file(program: &str) -> String {
    if cfg!(windows) {
        format!("{program}.exe")
    } else {
        program.to_string()
    }
}

pub(super) fn rust_analyzer_asset(os: &str, arch: &str) -> Option<String> {
    let arch = match arch {
        "aarch64" | "x86_64" => arch,
        _ => return None,
    };
    let target = match os {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        "windows" => "pc-windows-msvc",
        _ => return None,
    };
    Some(format!("rust-analyzer-{arch}-{target}.gz"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_ids_name_a_language() {
        for language in ALL {
            assert_eq!(Language::from_id(language.id()), Ok(language));
            assert_eq!(ALL[language.index()], language);
        }
        assert!(Language::from_id("/bin/sh").is_err());
        assert!(Language::from_id("").is_err());
    }

    #[test]
    fn rust_analyzer_has_an_asset_for_each_desktop() {
        assert_eq!(
            rust_analyzer_asset("macos", "aarch64").as_deref(),
            Some("rust-analyzer-aarch64-apple-darwin.gz")
        );
        assert_eq!(
            rust_analyzer_asset("linux", "x86_64").as_deref(),
            Some("rust-analyzer-x86_64-unknown-linux-gnu.gz")
        );
        assert_eq!(
            rust_analyzer_asset("windows", "x86_64").as_deref(),
            Some("rust-analyzer-x86_64-pc-windows-msvc.gz")
        );
        assert_eq!(rust_analyzer_asset("freebsd", "x86_64"), None);
    }
}
