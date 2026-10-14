//! Write replaces a file's content, but only while the file is still the version the editor
//! loaded (ADR-0009).

use super::cksum::cksum;
use super::paths::{check_rel, io_error, script_argv};
use super::read::{parse_stat, FileVersion};
use super::MAX_TEXT_BYTES;
use crate::error::{AppError, AppResult};
use crate::transport::{exec_input, Transport};

/// `$1` root, `$2` file, `$3` `check` or `force`, `$4` size, `$5` mtime, `$6` cksum (empty when
/// forced), `$7` the byte length of the new content; stdin is the new content. Exit 3 no such
/// root, 5 no such file (or, forced, no such folder), 6 the file is not the expected version,
/// 7 too many links, 8 not a file, 9 fewer bytes arrived than `$7` (an ssh client that dies
/// mid-transfer closes stdin, and `cat` takes that EOF for the end of the content). Links are
/// followed by hand so the temp file lands beside the real file and the link survives; the
/// temp file takes the old mode and replaces the file with one `mv`.
const WRITE_SCRIPT: &str = r#"cd "$1" || exit 3
f="./$2"
n=0
while [ -L "$f" ]; do
  n=$((n+1)); [ "$n" -le 40 ] || exit 7
  l=$(readlink -- "$f") || exit 1
  case "$l" in /*) f="$l";; *) f="$(dirname -- "$f")/$l";; esac
done
if [ -e "$f" ] && [ ! -f "$f" ]; then exit 8; fi
if [ "$3" = check ]; then
  [ -f "$f" ] || exit 5
  s=$(stat -c '%s %Y' -- "$f" 2>/dev/null || stat -f '%z %m' -- "$f") || exit 1
  [ "$s" = "$4 $5" ] || exit 6
  c=$(cksum < "$f") || exit 1
  [ "${c%% *}" = "$6" ] || exit 6
else
  [ -d "$(dirname -- "$f")" ] || exit 5
fi
t="$(dirname -- "$f")/.$(basename -- "$f").drover-$$.tmp"
trap 'rm -f -- "$t"' EXIT
cat > "$t" || exit 1
[ "$(wc -c < "$t" | tr -d " ")" = "$7" ] || exit 9
if [ -f "$f" ]; then
  m=$(stat -c '%a' -- "$f" 2>/dev/null || stat -f '%Lp' -- "$f") || exit 1
  chmod "$m" "$t" || exit 1
fi
mv -f -- "$t" "$f" || exit 1
stat -c '%s %Y' -- "$f" 2>/dev/null || stat -f '%z %m' -- "$f""#;

/// An item below the root: not the root itself, and every segment a real name (no empty,
/// `.` or `..` segment, so no trailing `/` either).
fn check_item(rel: &str) -> AppResult<()> {
    check_rel(rel)?;
    if rel.split('/').any(|s| s.is_empty() || s == ".") {
        return Err(AppError::new("invalid", format!("invalid path: {rel:?}")));
    }
    Ok(())
}

/// The error for WRITE_SCRIPT's exit `status` (non-zero).
fn write_error(status: i32, stderr: &str, root: &str, rel: &str) -> AppError {
    match status {
        3 => AppError::new("not_found", format!("no such folder: {root:?}")),
        5 => AppError::new("not_found", format!("no such file: {rel:?}")),
        6 => AppError::new("conflict", format!("{rel} changed on disk")),
        7 => AppError::new("invalid", format!("too many links: {rel:?}")),
        8 => AppError::new("invalid", format!("{rel} is not a file")),
        9 => AppError::new("io", "incomplete write"),
        s => io_error(s, stderr),
    }
}

/// Replaces `rel`'s content with `text` (ADR-0009): only while it is still `expected`, or
/// regardless when `expected` is None (Overwrite / Save again); atomically, through links.
pub async fn write(
    t: &dyn Transport,
    root: &str,
    rel: &str,
    text: &str,
    expected: Option<FileVersion>,
) -> AppResult<FileVersion> {
    check_item(rel)?;
    if text.len() > MAX_TEXT_BYTES {
        return Err(AppError::new("invalid", "text larger than 2 MB"));
    }
    let (mode, size, mtime, sum) = match expected {
        Some(v) => (
            "check",
            v.size.to_string(),
            v.mtime.to_string(),
            v.cksum.to_string(),
        ),
        None => ("force", String::new(), String::new(), String::new()),
    };
    let len = text.len().to_string();
    let argv = script_argv(WRITE_SCRIPT, &[root, rel, mode, &size, &mtime, &sum, &len]);
    let out = exec_input(t, &argv, Some(text.as_bytes())).await?;
    if out.status != 0 {
        return Err(write_error(out.status, &out.stderr, root, rel));
    }
    let stat = out
        .stdout
        .lines()
        .last()
        .and_then(parse_stat)
        .ok_or_else(|| AppError::new("io", "unexpected output from the file script"))?;
    Ok(FileVersion {
        size: stat.size,
        mtime: stat.mtime,
        cksum: cksum(text.as_bytes()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::read::read_file;
    use crate::transport::local::LocalTransport;
    use std::path::Path;

    fn root() -> (tempfile::TempDir, String) {
        let tmp = tempfile::tempdir().unwrap();
        let r = tmp.path().join("r o'ot");
        std::fs::create_dir_all(r.join("src")).unwrap();
        let s = r.to_string_lossy().into_owned();
        (tmp, s)
    }

    fn code(e: crate::error::AppError) -> String {
        e.code
    }

    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    fn ver(path: &str) -> FileVersion {
        let m = std::fs::metadata(path).unwrap();
        FileVersion {
            size: m.size(),
            mtime: m.mtime() as u64,
            cksum: cksum(&std::fs::read(path).unwrap()),
        }
    }

    fn temp_left(dir: &str) -> bool {
        std::fs::read_dir(dir).unwrap().any(|e| {
            e.unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".drover-")
        })
    }

    #[tokio::test]
    async fn writes_over_the_expected_version_and_keeps_the_mode() {
        let (_t, r) = root();
        let p = format!("{r}/src/a b.txt");
        std::fs::write(&p, "old\n").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o750)).unwrap();
        let v = write(
            &LocalTransport,
            &r,
            "src/a b.txt",
            "new\r\nline\n",
            Some(ver(&p)),
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "new\r\nline\n");
        assert_eq!(
            std::fs::metadata(&p).unwrap().permissions().mode() & 0o777,
            0o750
        );
        assert_eq!(v, ver(&p));
        assert!(!temp_left(&format!("{r}/src")));
    }

    #[tokio::test]
    async fn a_changed_file_is_a_conflict_and_stays_untouched() {
        let (_t, r) = root();
        let p = format!("{r}/src/a.txt");
        std::fs::write(&p, "old\n").unwrap();
        let mut stale = ver(&p);
        stale.cksum ^= 1;
        let e = write(&LocalTransport, &r, "src/a.txt", "mine\n", Some(stale))
            .await
            .unwrap_err();
        assert_eq!(code(e), "conflict");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "old\n");
        let mut stale = ver(&p);
        stale.mtime -= 5;
        let e = write(&LocalTransport, &r, "src/a.txt", "mine\n", Some(stale))
            .await
            .unwrap_err();
        assert_eq!(code(e), "conflict");
        assert!(!temp_left(&format!("{r}/src")));
    }

    #[tokio::test]
    async fn expected_on_a_removed_file_is_not_found() {
        let (_t, r) = root();
        let v = FileVersion {
            size: 1,
            mtime: 1,
            cksum: 1,
        };
        let e = write(&LocalTransport, &r, "src/gone.txt", "x", Some(v))
            .await
            .unwrap_err();
        assert_eq!(code(e), "not_found");
    }

    #[tokio::test]
    async fn force_overwrites_and_recreates_but_needs_the_folder() {
        let (_t, r) = root();
        let p = format!("{r}/src/a.txt");
        std::fs::write(&p, "theirs\n").unwrap();
        write(&LocalTransport, &r, "src/a.txt", "mine\n", None)
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "mine\n");
        std::fs::remove_file(&p).unwrap();
        let v = write(&LocalTransport, &r, "src/a.txt", "back\n", None)
            .await
            .unwrap();
        assert_eq!(v, ver(&p));
        let e = write(&LocalTransport, &r, "nope/a.txt", "x", None)
            .await
            .unwrap_err();
        assert_eq!(code(e), "not_found");
    }

    #[tokio::test]
    async fn an_interrupted_transfer_leaves_the_file_untouched() {
        // An ssh client that dies mid-save closes the remote stdin: `cat` sees EOF and
        // succeeds, so the script must compare the bytes it got with the length it was sent.
        let (_t, r) = root();
        let p = format!("{r}/src/a.txt");
        std::fs::write(&p, "old content\n").unwrap();
        for (mode, size, mtime, sum) in [
            ("force", String::new(), String::new(), String::new()),
            (
                "check",
                ver(&p).size.to_string(),
                ver(&p).mtime.to_string(),
                ver(&p).cksum.to_string(),
            ),
        ] {
            let argv = script_argv(
                WRITE_SCRIPT,
                &[&r, "src/a.txt", mode, &size, &mtime, &sum, "20"],
            );
            let out = exec_input(&LocalTransport, &argv, Some(b"partial"))
                .await
                .unwrap();
            assert_eq!(out.status, 9, "{mode}");
            let e = write_error(out.status, &out.stderr, &r, "src/a.txt");
            assert_eq!(
                (e.code.as_str(), e.message.as_str()),
                ("io", "incomplete write")
            );
            assert_eq!(std::fs::read_to_string(&p).unwrap(), "old content\n");
            assert!(!temp_left(&format!("{r}/src")));
        }
    }

    #[tokio::test]
    async fn writes_through_a_symlink_and_keeps_the_link() {
        let (_t, r) = root();
        let p = format!("{r}/src/a.txt");
        std::fs::write(&p, "old\n").unwrap();
        std::os::unix::fs::symlink("src/a.txt", format!("{r}/link.txt")).unwrap();
        write(&LocalTransport, &r, "link.txt", "new\n", Some(ver(&p)))
            .await
            .unwrap();
        assert!(std::fs::symlink_metadata(format!("{r}/link.txt"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "new\n");
    }

    #[tokio::test]
    async fn refuses_a_folder_too_much_text_and_unclean_paths() {
        let (_t, r) = root();
        assert_eq!(
            code(
                write(&LocalTransport, &r, "src", "x", None)
                    .await
                    .unwrap_err()
            ),
            "invalid"
        );
        let big = "a".repeat(MAX_TEXT_BYTES + 1);
        assert_eq!(
            code(
                write(&LocalTransport, &r, "src/a.txt", &big, None)
                    .await
                    .unwrap_err()
            ),
            "invalid"
        );
        for rel in ["", "../x", "src//a", "./a"] {
            assert_eq!(
                code(
                    write(&LocalTransport, &r, rel, "x", None)
                        .await
                        .unwrap_err()
                ),
                "invalid",
                "{rel:?}"
            );
        }
    }

    #[tokio::test]
    async fn refuses_the_root_and_unclean_paths() {
        let (_t, r) = root();
        let p = format!("{r}/src/a.txt");
        std::fs::write(&p, "keep").unwrap();
        for rel in ["", "src/", "a//b", "./src", "src/.", "../x", "/etc"] {
            let e = write(&LocalTransport, &r, rel, "x", None)
                .await
                .unwrap_err();
            assert_eq!(code(e), "invalid", "write {rel:?}");
        }
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "keep");
        assert!(Path::new(&format!("{r}/src")).is_dir());
    }

    #[tokio::test]
    async fn crlf_bytes_come_back_unchanged_and_no_temp_file_is_left() {
        let (_t, r) = root();
        std::fs::write(format!("{r}/a.txt"), b"x\r\ny\r\n").unwrap();
        let c = read_file(&LocalTransport, &r, "a.txt").await.unwrap();
        let v = FileVersion {
            size: c.size,
            mtime: c.mtime,
            cksum: c.cksum.unwrap(),
        };
        write(&LocalTransport, &r, "a.txt", "x\r\nz\r\n", Some(v))
            .await
            .unwrap();
        assert_eq!(std::fs::read(format!("{r}/a.txt")).unwrap(), b"x\r\nz\r\n");
        // root() already holds src/; the temp file would be a third entry.
        let mut names: Vec<_> = std::fs::read_dir(&r)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                std::ffi::OsString::from("a.txt"),
                std::ffi::OsString::from("src")
            ]
        );
    }
}
