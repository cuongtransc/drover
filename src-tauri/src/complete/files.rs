//! Files under a Pane's working directory, for `@file` completion.
use crate::error::AppResult;
use crate::transport::{exec, sh_quote, Transport};

/// The folders hidden when the user has not chosen their own (Settings → Files).
pub const DEFAULT_HIDDEN: &[&str] = &[
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    "target",
    "dist",
    "build",
    ".next",
    ".worktrees",
];

/// Folder names the file listings and the Files watch leave out: the Files panel's hidden
/// folders. Only plain names are kept (no `/`, `.`, `..` or control characters), each once.
#[derive(Debug, Clone, PartialEq)]
pub struct HiddenFolders(Vec<String>);

impl Default for HiddenFolders {
    fn default() -> Self {
        Self::new(DEFAULT_HIDDEN.iter().copied())
    }
}

impl HiddenFolders {
    pub fn new<S: AsRef<str>>(names: impl IntoIterator<Item = S>) -> Self {
        let mut kept: Vec<String> = Vec::new();
        for name in names {
            let name = name.as_ref().trim();
            let plain = !name.is_empty()
                && name != "."
                && name != ".."
                && !name.contains('/')
                && !name.chars().any(char::is_control);
            if plain && !kept.iter().any(|k| k == name) {
                kept.push(name.to_string());
            }
        }
        Self(kept)
    }

    /// The UI's list, or the defaults when it sent none.
    pub fn from_setting(names: Option<Vec<String>>) -> Self {
        names.map_or_else(Self::default, Self::new)
    }

    pub fn names(&self) -> &[String] {
        &self.0
    }

    pub fn contains(&self, name: &str) -> bool {
        self.0.iter().any(|n| n == name)
    }

    /// `-name 'a' -o -name 'b'`, each name quoted and glob-escaped so it matches only itself;
    /// `-name ''` (matching nothing) when the list is empty.
    pub fn find_names(&self) -> String {
        if self.0.is_empty() {
            return "-name ''".to_string();
        }
        self.0
            .iter()
            .map(|n| format!("-name {}", sh_quote(&glob_escape(n))))
            .collect::<Vec<_>>()
            .join(" -o ")
    }

    /// A `find` expression that prunes the hidden folders (files with those names are kept);
    /// follow it with `-o` and what to print.
    pub fn find_prune(&self) -> String {
        format!("\\( -type d \\( {} \\) \\) -prune", self.find_names())
    }
}

/// Escape a path or name for a `find -name`/`-path` glob.
pub fn glob_escape(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        if "*?[]\\".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

const MAX_DEPTH: usize = 6;
const MAX_FILES: usize = 5000;

/// Whether `dir` is the home folder (trailing `/` ignored). Scanning it would walk
/// `~/Library` and trigger macOS privacy prompts, so callers refuse it.
pub fn is_home(home: &str, dir: &str) -> bool {
    dir.trim_end_matches('/') == home.trim_end_matches('/')
}

/// Paths relative to `cwd`, `/`-separated and sorted; empty when `cwd` is missing or
/// is the home folder, which would scan `~/Library` and trigger macOS privacy prompts.
pub async fn list_files(
    t: &dyn Transport,
    home: &str,
    cwd: &str,
    hidden: &HiddenFolders,
) -> AppResult<Vec<String>> {
    // The home folder holds no project files, so skip it before running anything.
    if is_home(home, cwd) {
        return Ok(Vec::new());
    }
    let prune = hidden.find_prune();
    // Only folders are pruned: a file named `build` is still listed.
    // -maxdepth goes first: GNU find warns when it follows other expressions.
    let script = format!(
        "cd \"$1\" 2>/dev/null || exit 0; find . -maxdepth {MAX_DEPTH} {prune} -o -type f -print | head -n {MAX_FILES}"
    );
    let argv = vec![
        "sh".to_string(),
        "-c".into(),
        script,
        "sh".into(),
        cwd.to_string(),
    ];
    let o = exec(t, &argv).await?;
    let mut files: Vec<String> = o
        .stdout
        .lines()
        .map(|l| l.strip_prefix("./").unwrap_or(l).to_string())
        .filter(|l| !l.is_empty())
        .collect();
    files.sort();
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::local::LocalTransport;

    #[tokio::test]
    async fn lists_files_relative_to_cwd_skipping_heavy_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("my repo");
        for p in [
            "README.md",
            "src/a.ts",
            "src/deep/b.ts",
            "node_modules/x/i.js",
            ".venv/lib/y.py",
            "venv/z.py",
            "target/debug/out",
            ".git/HEAD",
            "a/b/c/d/e/f.txt",
            "a/b/c/d/e/f/g.txt",
            "has space/n.md",
            "scripts/build",
            "dist",
        ] {
            let f = root.join(p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, "").unwrap();
        }
        let got = list_files(
            &LocalTransport,
            "/nonexistent-home",
            &root.to_string_lossy(),
            &HiddenFolders::default(),
        )
        .await
        .unwrap();
        assert_eq!(
            got,
            vec![
                "README.md",
                "a/b/c/d/e/f.txt",
                "dist",
                "has space/n.md",
                "scripts/build",
                "src/a.ts",
                "src/deep/b.ts"
            ]
        );
    }

    #[test]
    fn hidden_folders_keep_only_plain_names() {
        let h = HiddenFolders::new([
            "  build ", "", ".", "..", "a/b", "x\ny", "nul\0", "build", "out",
        ]);
        assert_eq!(h.names(), ["build", "out"]);
        assert!(h.contains("out"));
        assert!(!h.contains("node_modules"));
    }

    #[test]
    fn no_setting_means_the_default_folders() {
        assert_eq!(HiddenFolders::from_setting(None), HiddenFolders::default());
        assert!(HiddenFolders::default().contains("node_modules"));
        assert_eq!(
            HiddenFolders::from_setting(Some(vec!["out".into()])).names(),
            ["out"]
        );
    }

    #[test]
    fn find_prune_quotes_and_escapes_each_name() {
        let h = HiddenFolders::new(["out", "*.egg", "$(touch x)", "it's"]);
        assert_eq!(
            h.find_prune(),
            r"\( -type d \( -name 'out' -o -name '\*.egg' -o -name '$(touch x)' -o -name 'it'\''s' \) \) -prune"
        );
        // Nothing hidden: a test no folder passes, so the expression stays valid.
        assert_eq!(
            HiddenFolders::new(Vec::<String>::new()).find_prune(),
            r"\( -type d \( -name '' \) \) -prune"
        );
    }

    #[tokio::test]
    async fn lists_what_a_custom_list_does_not_hide() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        for p in ["out/a.js", "node_modules/m.js", "*/star.txt", "keep.md"] {
            let f = root.join(p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, "").unwrap();
        }
        let got = list_files(
            &LocalTransport,
            "/nonexistent-home",
            &root.to_string_lossy(),
            &HiddenFolders::new(["out", "*"]),
        )
        .await
        .unwrap();
        assert_eq!(got, vec!["keep.md", "node_modules/m.js"]);
    }

    #[tokio::test]
    async fn a_missing_cwd_has_no_files() {
        let got = list_files(
            &LocalTransport,
            "/nonexistent-home",
            "/nonexistent/drover",
            &HiddenFolders::default(),
        )
        .await
        .unwrap();
        assert!(got.is_empty());
    }

    #[tokio::test]
    async fn the_home_folder_has_no_files() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path().join("home");
        std::fs::create_dir_all(home.join("Library/Caches")).unwrap();
        std::fs::write(home.join("Library/Caches/x"), "").unwrap();
        std::fs::write(home.join("notes.md"), "").unwrap();
        let h = home.to_string_lossy().into_owned();
        for (home_arg, cwd) in [
            (h.clone(), h.clone()),
            (h.clone(), format!("{h}/")),
            (format!("{h}/"), h.clone()),
        ] {
            let got = list_files(&LocalTransport, &home_arg, &cwd, &HiddenFolders::default())
                .await
                .unwrap();
            assert!(got.is_empty(), "home={home_arg} cwd={cwd}: {got:?}");
        }
    }
}
