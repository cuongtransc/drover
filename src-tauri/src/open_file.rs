//! Opening, on this Mac, a file a chat message names, on Cmd+click (a plain click opens it in Files).
//!
//! The path comes from an agent's transcript, so a click must never run anything: only kinds that
//! open in a viewer or an editor go to the default app; anything else (`.command`, `.app`, a
//! script, an extensionless binary, a folder) is only revealed in Finder.
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::Path;

/// What a click did with the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Opened {
    Opened,
    Revealed,
}

/// Kinds a viewer or an editor opens; none of them runs code when opened.
const VIEWABLE: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "heic", "bmp", "tif", "tiff", "svg", "pdf", "md",
    "markdown", "txt", "log", "json", "jsonl", "yaml", "yml", "toml", "csv", "tsv",
];

/// Whether `path` is a kind the default app may open; everything else is only revealed.
pub fn opens_in_default_app(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    // `.png` alone is a hidden file named "png", not a PNG.
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty() && VIEWABLE.contains(&ext.to_ascii_lowercase().as_str())
}

/// What a click on `path` should do, after checking it is an absolute path that exists.
pub fn decide(path: &Path) -> AppResult<Opened> {
    let meta = existing(path)?;
    Ok(if meta.is_file() && opens_in_default_app(path) {
        Opened::Opened
    } else {
        Opened::Revealed
    })
}

/// Checks `path` before it is revealed in Finder: any kind, as revealing runs nothing.
pub fn check_reveal(path: &Path) -> AppResult<()> {
    existing(path).map(|_| ())
}

/// The metadata of `path`, an absolute path that exists.
fn existing(path: &Path) -> AppResult<std::fs::Metadata> {
    if !path.is_absolute() {
        return Err(AppError::new(
            "invalid",
            format!("not an absolute path: {}", path.display()),
        ));
    }
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(AppError::new(
                "not_found",
                format!("{} does not exist", path.display()),
            ));
        }
        Err(e) => return Err(e.into()),
    };
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn opens_viewer_and_text_kinds_only() {
        for ok in [
            "a.png", "b.JPG", "c.pdf", "d.md", "e.txt", "f.json", "g.log", "h.csv", "i.svg",
        ] {
            assert!(opens_in_default_app(Path::new(ok)), "{ok}");
        }
        for no in [
            "run.command",
            "Evil.app",
            "x.sh",
            "y.terminal",
            "z.pkg",
            "w.dmg",
            "s.scpt",
            "page.html",
            "bin",
            ".png",
        ] {
            assert!(!opens_in_default_app(Path::new(no)), "{no}");
        }
    }

    #[test]
    fn decides_open_reveal_or_refuse() {
        let dir = tempfile::tempdir().unwrap();
        let png = dir.path().join("shot.png");
        let script = dir.path().join("run.command");
        fs::write(&png, b"x").unwrap();
        fs::write(&script, b"x").unwrap();
        assert_eq!(decide(&png).unwrap(), Opened::Opened);
        assert_eq!(decide(&script).unwrap(), Opened::Revealed);
        assert_eq!(decide(dir.path()).unwrap(), Opened::Revealed);
        assert_eq!(
            decide(&dir.path().join("gone.png")).unwrap_err().code,
            "not_found"
        );
        assert_eq!(decide(Path::new("rel/a.png")).unwrap_err().code, "invalid");
    }

    #[test]
    fn reveals_only_an_absolute_path_that_exists() {
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("run.command");
        fs::write(&script, b"x").unwrap();
        assert!(check_reveal(&script).is_ok());
        assert!(check_reveal(dir.path()).is_ok());
        assert_eq!(
            check_reveal(&dir.path().join("gone.txt")).unwrap_err().code,
            "not_found"
        );
        assert_eq!(
            check_reveal(Path::new("rel/a")).unwrap_err().code,
            "invalid"
        );
    }
}
