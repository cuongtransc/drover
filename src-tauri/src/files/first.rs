//! Which of several places a file named in Chat is at: the first that is a file on the Machine.

use super::paths::{io_error, script_argv};
use crate::error::{AppError, AppResult};
use crate::transport::{exec_bytes, Transport};

/// The most places one click may try.
pub const MAX_CANDIDATES: usize = 64;

/// Prints the first argument that is a file (a link to one counts); exit 1 when none is.
const FIRST_SCRIPT: &str = r#"for p in "$@"; do
  if [ -f "$p" ]; then printf '%s\n' "$p"; exit 0; fi
done
exit 1"#;

/// The first of `paths` that is a file, in order, or None.
pub async fn first_file(t: &dyn Transport, paths: &[String]) -> AppResult<Option<String>> {
    if paths.len() > MAX_CANDIDATES {
        return Err(AppError::new(
            "invalid",
            format!("more than {MAX_CANDIDATES} places"),
        ));
    }
    for p in paths {
        if !p.starts_with('/') || p.contains('\0') || p.contains('\n') {
            return Err(AppError::new(
                "invalid",
                format!("not an absolute path: {p:?}"),
            ));
        }
    }
    if paths.is_empty() {
        return Ok(None);
    }
    let args: Vec<&str> = paths.iter().map(String::as_str).collect();
    let out = exec_bytes(t, &script_argv(FIRST_SCRIPT, &args)).await?;
    match out.status {
        0 => Ok(Some(
            String::from_utf8_lossy(&out.stdout)
                .trim_end_matches('\n')
                .to_string(),
        )),
        1 => Ok(None),
        s => Err(io_error(s, &out.stderr)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::local::LocalTransport;

    #[tokio::test]
    async fn the_first_that_is_a_file_in_order() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path().to_string_lossy().into_owned();
        std::fs::create_dir_all(format!("{d}/dir/a.md")).unwrap();
        std::fs::write(format!("{d}/b c.md"), "x").unwrap();
        std::fs::write(format!("{d}/d.md"), "x").unwrap();
        let paths = [
            format!("{d}/gone.md"),
            format!("{d}/dir/a.md"),
            format!("{d}/b c.md"),
            format!("{d}/d.md"),
        ];
        assert_eq!(
            first_file(&LocalTransport, &paths).await.unwrap(),
            Some(format!("{d}/b c.md"))
        );
    }

    #[tokio::test]
    async fn none_when_no_place_holds_the_file() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path().to_string_lossy().into_owned();
        let paths = [format!("{d}/x.md"), d.clone()];
        assert_eq!(first_file(&LocalTransport, &paths).await.unwrap(), None);
        assert_eq!(first_file(&LocalTransport, &[]).await.unwrap(), None);
    }

    #[tokio::test]
    async fn refuses_a_relative_path_or_too_many() {
        let e = first_file(&LocalTransport, &["rel/a.md".into()])
            .await
            .unwrap_err();
        assert_eq!(e.code, "invalid");
        let many = vec!["/a.md".to_string(); MAX_CANDIDATES + 1];
        assert_eq!(
            first_file(&LocalTransport, &many).await.unwrap_err().code,
            "invalid"
        );
    }
}
