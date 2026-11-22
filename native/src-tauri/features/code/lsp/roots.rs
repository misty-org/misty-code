use std::path::{Path, PathBuf};

use super::catalog::Language;

pub(super) fn workspace_root(language: Language, folder: &Path, file: &Path) -> PathBuf {
    let Some(start) = file.parent().filter(|parent| parent.starts_with(folder)) else {
        return folder.to_path_buf();
    };
    let Some(nearest) = up_from(start, folder)
        .find(|dir| language.root_markers().iter().any(|name| has(dir, name)))
    else {
        return folder.to_path_buf();
    };
    match language {
        Language::Rust => up_from(nearest, folder)
            .find(|dir| declares_workspace(&dir.join("Cargo.toml")))
            .unwrap_or(nearest)
            .to_path_buf(),
        Language::Go => up_from(nearest, folder)
            .find(|dir| has(dir, "go.work"))
            .unwrap_or(nearest)
            .to_path_buf(),
        Language::TypeScript | Language::Python => nearest.to_path_buf(),
    }
}

fn up_from<'a>(start: &'a Path, folder: &'a Path) -> impl Iterator<Item = &'a Path> {
    start
        .ancestors()
        .take_while(move |dir| dir.starts_with(folder))
}

fn has(dir: &Path, name: &str) -> bool {
    file_access::fs::is_file(dir.join(name))
}

fn declares_workspace(manifest: &Path) -> bool {
    let Ok(text) = file_access::fs::read_to_string(manifest) else {
        return false;
    };
    text.parse::<toml::Table>()
        .is_ok_and(|table| table.contains_key("workspace"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_walk_stops_at_the_linked_folder() {
        let folder = Path::new("/work/repo");
        let start = Path::new("/work/repo/crates/a/src");
        let seen: Vec<&Path> = up_from(start, folder).collect();
        assert_eq!(seen.first(), Some(&start));
        assert_eq!(seen.last(), Some(&folder));
        assert!(seen.iter().all(|dir| dir.starts_with(folder)));
    }

    #[test]
    fn a_file_outside_the_folder_uses_the_folder() {
        let folder = Path::new("/work/repo");
        assert_eq!(
            workspace_root(Language::Rust, folder, Path::new("/elsewhere/main.rs")),
            folder.to_path_buf()
        );
    }
}
