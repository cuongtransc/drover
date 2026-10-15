//! Where the files named in Chat are: for each path, the first of the places it may be that is a
//! file on the Machine. One call answers every path a screen of messages names.

use super::paths::{io_error, script_argv};
use crate::error::{AppError, AppResult};
use crate::transport::{exec_bytes, Transport};

/// The most places one call may try, over all groups: keeps the command line (sent over ssh for a
/// remote Machine) near 100 KB.
pub const MAX_PLACES: usize = 1024;

/// Groups of places, each ended by `--`; prints one line per group, the first that is a file (a
/// link to one counts) or empty. A place is absolute, so never `--`.
const FIRST_SCRIPT: &str = r#"found=; skip=
for p in "$@"; do
  if [ "$p" = "--" ]; then printf '%s\n' "$found"; found=; skip=; continue; fi
  [ -n "$skip" ] && continue
  if [ -f "$p" ]; then found=$p; skip=1; fi
done"#;

/// For each group, in order, its first place that is a file, or None.
pub async fn first_files(
    t: &dyn Transport,
    groups: &[Vec<String>],
) -> AppResult<Vec<Option<String>>> {
    let total: usize = groups.iter().map(Vec::len).sum();
    if total > MAX_PLACES {
        return Err(AppError::new(
            "invalid",
            format!("more than {MAX_PLACES} places"),
        ));
    }
    let mut args: Vec<&str> = Vec::with_capacity(total + groups.len());
    for g in groups {
        for p in g {
            if !p.starts_with('/') || p.contains('\0') || p.contains('\n') {
                return Err(AppError::new(
                    "invalid",
                    format!("not an absolute path: {p:?}"),
                ));
            }
            args.push(p);
        }
        args.push("--");
    }
    if groups.is_empty() {
        return Ok(Vec::new());
    }
    let out = exec_bytes(t, &script_argv(FIRST_SCRIPT, &args)).await?;
    if out.status != 0 {
        return Err(io_error(out.status, &out.stderr));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let lines: Vec<&str> = text.split_terminator('\n').collect();
    if lines.len() != groups.len() {
        return Err(AppError::new(
            "io",
            "unexpected output from the file script",
        ));
    }
    Ok(lines
        .into_iter()
        .map(|l| (!l.is_empty()).then(|| l.to_string()))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::local::LocalTransport;

    fn dir() -> (tempfile::TempDir, String) {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path().to_string_lossy().into_owned();
        std::fs::create_dir_all(format!("{d}/dir/a.md")).unwrap();
        std::fs::write(format!("{d}/b c.md"), "x").unwrap();
        std::fs::write(format!("{d}/d.md"), "x").unwrap();
        (tmp, d)
    }

    #[tokio::test]
    async fn the_first_file_of_each_group_in_one_call() {
        let (_t, d) = dir();
        let groups = vec![
            vec![
                format!("{d}/gone.md"),
                format!("{d}/dir/a.md"),
                format!("{d}/b c.md"),
                format!("{d}/d.md"),
            ],
            vec![format!("{d}/gone.md"), d.clone()],
            vec![],
            vec![format!("{d}/d.md")],
        ];
        assert_eq!(
            first_files(&LocalTransport, &groups).await.unwrap(),
            vec![
                Some(format!("{d}/b c.md")),
                None,
                None,
                Some(format!("{d}/d.md"))
            ]
        );
        assert_eq!(
            first_files(&LocalTransport, &[]).await.unwrap(),
            Vec::<Option<String>>::new()
        );
    }

    #[tokio::test]
    async fn refuses_a_relative_path_or_too_many() {
        let e = first_files(&LocalTransport, &[vec!["rel/a.md".into()]])
            .await
            .unwrap_err();
        assert_eq!(e.code, "invalid");
        let many = vec![vec!["/a.md".to_string(); MAX_PLACES + 1]];
        assert_eq!(
            first_files(&LocalTransport, &many).await.unwrap_err().code,
            "invalid"
        );
    }
}
