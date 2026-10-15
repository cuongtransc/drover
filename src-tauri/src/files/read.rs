use serde::{Deserialize, Serialize};

use super::cksum::cksum;
use super::paths::{check_rel, io_error, is_image, is_pdf, script_argv};
use super::{BINARY_SNIFF_BYTES, MAX_IMAGE_BYTES, MAX_PDF_BYTES, MAX_TEXT_BYTES};
use crate::error::{AppError, AppResult};
use crate::transport::{exec_bytes, Transport};

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ContentKind {
    Text,
    Binary,
    Image,
    Pdf,
}

#[derive(Serialize, Debug)]
pub struct FileContent {
    pub kind: ContentKind,
    pub text: Option<String>,
    pub truncated: bool,
    pub size: u64,
    pub mtime: u64,
    /// Some only for text that was read whole.
    pub cksum: Option<u32>,
    /// Text, read whole, and valid UTF-8: the only content the editor can save back.
    pub editable: bool,
}

/// What a file looked like on disk when it was read; `files_write` checks it before saving.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
pub struct FileVersion {
    pub size: u64,
    pub mtime: u64,
    pub cksum: u32,
}

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
pub struct FileStat {
    pub size: u64,
    pub mtime: u64,
}

/// `$1` root, `$2` file below it, `$3` is `img` when the content is not wanted, `$4` the bytes
/// sniffed for a NUL, `$5` the most bytes of text read.
/// Exit 6 for a folder, 3 for anything else that is not a file.
/// Prints `size mtime` (GNU stat first, BSD/macOS stat as the fallback), a `1`/`0`
/// binary flag, then up to `$5` bytes of text. `od -c` writes a NUL byte as the two
/// characters backslash-zero, which `grep -F` matches portably.
const READ_SCRIPT: &str = r#"cd "$1" || exit 3
f="./$2"
[ -d "$f" ] && exit 6
[ -f "$f" ] || exit 3
stat -L -c '%s %Y' -- "$f" 2>/dev/null || stat -L -f '%z %m' -- "$f" || exit 3
[ "$3" = img ] && exit 0
if head -c "$4" -- "$f" | od -An -c | grep -qF '\0'; then echo 1; exit 0; fi
echo 0
head -c "$5" -- "$f""#;

/// `$1` root, `$2` file, `$3` size limit. Prints the stat line, exit 4 when over the limit,
/// exit 5 when the size is not a number, else the raw bytes.
const IMAGE_SCRIPT: &str = r#"cd "$1" || exit 3
f="./$2"
[ -d "$f" ] && exit 6
[ -f "$f" ] || exit 3
s=$(stat -L -c '%s %Y' -- "$f" 2>/dev/null || stat -L -f '%z %m' -- "$f") || exit 3
echo "$s"
case "${s%% *}" in ''|*[!0-9]*) exit 5;; esac
[ "${s%% *}" -le "$3" ] || exit 4
cat -- "$f""#;

pub(super) fn parse_stat(line: &str) -> Option<FileStat> {
    let (size, mtime) = line.trim().split_once(' ')?;
    Some(FileStat {
        size: size.parse().ok()?,
        mtime: mtime.parse().ok()?,
    })
}

/// Splits off the first line (without its newline); the rest is returned untouched.
fn split_line(bytes: &[u8]) -> (&[u8], &[u8]) {
    match bytes.iter().position(|b| *b == b'\n') {
        Some(i) => (&bytes[..i], &bytes[i + 1..]),
        None => (bytes, &[]),
    }
}

fn script_error(status: i32, stderr: &str, what: &str) -> AppError {
    match status {
        3 => AppError::new("not_found", format!("no such file: {what:?}")),
        6 => AppError::new("is_dir", format!("a folder: {what:?}")),
        _ => io_error(status, stderr),
    }
}

/// `bytes` without a UTF-8 sequence cut off at its end, so a truncated read decodes
/// without a trailing U+FFFD.
fn drop_partial_utf8(bytes: &[u8]) -> &[u8] {
    // The last lead byte is at most 3 bytes from the end of a sequence cut short.
    for back in 1..=bytes.len().min(4) {
        let i = bytes.len() - back;
        let b = bytes[i];
        if b & 0xC0 == 0x80 {
            continue; // a continuation byte
        }
        let want = match b {
            0x00..=0x7F => 1,
            0xC0..=0xDF => 2,
            0xE0..=0xEF => 3,
            0xF0..=0xF7 => 4,
            _ => return bytes,
        };
        return if back < want { &bytes[..i] } else { bytes };
    }
    bytes
}

fn bad_output() -> AppError {
    AppError::new("io", "unexpected output from the file script")
}

pub async fn read_file(t: &dyn Transport, root: &str, rel: &str) -> AppResult<FileContent> {
    check_rel(rel)?;
    let viewer = if is_image(rel) {
        Some(ContentKind::Image)
    } else if is_pdf(rel) {
        Some(ContentKind::Pdf)
    } else {
        None
    };
    let flag = if viewer.is_some() { "img" } else { "txt" };
    let (sniff, max) = (BINARY_SNIFF_BYTES.to_string(), MAX_TEXT_BYTES.to_string());
    let out = exec_bytes(
        t,
        &script_argv(READ_SCRIPT, &[root, rel, flag, &sniff, &max]),
    )
    .await?;
    if out.status != 0 {
        return Err(script_error(out.status, &out.stderr, rel));
    }
    let (stat, rest) = split_line(&out.stdout);
    let FileStat { size, mtime } =
        parse_stat(&String::from_utf8_lossy(stat)).ok_or_else(bad_output)?;
    let content = |kind, text, truncated| FileContent {
        kind,
        text,
        truncated,
        size,
        mtime,
        cksum: None,
        editable: false,
    };
    if let Some(kind) = viewer {
        return Ok(content(kind, None, false));
    }
    let (binary, body) = split_line(rest);
    match binary {
        b"1" => return Ok(content(ContentKind::Binary, None, false)),
        b"0" => {}
        _ => return Err(bad_output()),
    }
    let truncated = size > MAX_TEXT_BYTES as u64;
    let body = if truncated {
        drop_partial_utf8(body)
    } else {
        body
    };
    let mut c = content(
        ContentKind::Text,
        Some(String::from_utf8_lossy(body).into_owned()),
        truncated,
    );
    // Only a body exactly as long as stat said is that version: a file that grew or shrank
    // between the stat and the read must not be saved back over.
    if !truncated && body.len() as u64 == size {
        c.cksum = Some(cksum(body));
        c.editable = std::str::from_utf8(body).is_ok();
    }
    Ok(c)
}

pub async fn read_image(t: &dyn Transport, root: &str, rel: &str) -> AppResult<Vec<u8>> {
    read_bytes(t, root, rel, MAX_IMAGE_BYTES, "image").await
}

pub async fn read_pdf(t: &dyn Transport, root: &str, rel: &str) -> AppResult<Vec<u8>> {
    read_bytes(t, root, rel, MAX_PDF_BYTES, "PDF").await
}

/// The whole file, refused when larger than `limit`; `what` names the kind in that error.
async fn read_bytes(
    t: &dyn Transport,
    root: &str,
    rel: &str,
    limit: usize,
    what: &str,
) -> AppResult<Vec<u8>> {
    check_rel(rel)?;
    let max = limit.to_string();
    let out = exec_bytes(t, &script_argv(IMAGE_SCRIPT, &[root, rel, &max])).await?;
    match out.status {
        0 => {}
        4 => {
            let mb = limit / (1024 * 1024);
            return Err(AppError::new(
                "invalid",
                format!("{what} larger than {mb} MB"),
            ));
        }
        5 => return Err(bad_output()),
        s => return Err(script_error(s, &out.stderr, rel)),
    }
    Ok(split_line(&out.stdout).1.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transport::local::LocalTransport;

    fn root() -> (tempfile::TempDir, String) {
        let tmp = tempfile::tempdir().unwrap();
        let r = tmp.path().join("r o'ot");
        std::fs::create_dir_all(r.join("src")).unwrap();
        let s = r.to_string_lossy().into_owned();
        (tmp, s)
    }

    #[tokio::test]
    async fn reads_text_with_size_and_mtime() {
        let (_t, r) = root();
        std::fs::write(format!("{r}/src/a b.ts"), "let x = 1;\n").unwrap();
        let c = read_file(&LocalTransport, &r, "src/a b.ts").await.unwrap();
        assert!(matches!(c.kind, ContentKind::Text));
        assert_eq!(c.text.as_deref(), Some("let x = 1;\n"));
        assert_eq!(c.size, 11);
        assert!(!c.truncated);
        assert!(c.mtime > 1_600_000_000);
    }

    #[tokio::test]
    async fn text_is_editable_with_its_cksum() {
        let (_t, r) = root();
        std::fs::write(format!("{r}/crlf.txt"), b"a\r\nb\n").unwrap();
        let c = read_file(&LocalTransport, &r, "crlf.txt").await.unwrap();
        assert!(c.editable);
        assert_eq!(c.cksum, Some(crate::files::cksum::cksum(b"a\r\nb\n")));
        assert_eq!(c.text.as_deref(), Some("a\r\nb\n"));
    }

    #[tokio::test]
    async fn invalid_utf8_and_truncated_text_are_not_editable() {
        let (_t, r) = root();
        std::fs::write(format!("{r}/latin1.txt"), [b'a', 0xE9, b'b', b'\n']).unwrap();
        let c = read_file(&LocalTransport, &r, "latin1.txt").await.unwrap();
        assert!(!c.editable);
        assert!(c.cksum.is_some());
        std::fs::write(format!("{r}/big.txt"), vec![b'a'; MAX_TEXT_BYTES + 1]).unwrap();
        let c = read_file(&LocalTransport, &r, "big.txt").await.unwrap();
        assert!(c.truncated && !c.editable);
        assert_eq!(c.cksum, None);
    }

    #[tokio::test]
    async fn binary_and_images_are_not_editable() {
        let (_t, r) = root();
        std::fs::write(format!("{r}/b.bin"), [0u8, 1, 2]).unwrap();
        std::fs::write(format!("{r}/i.png"), [0x89u8, b'P', b'N', b'G']).unwrap();
        for rel in ["b.bin", "i.png"] {
            let c = read_file(&LocalTransport, &r, rel).await.unwrap();
            assert!(!c.editable, "{rel}");
            assert_eq!(c.cksum, None, "{rel}");
        }
    }

    #[tokio::test]
    async fn binary_and_truncated_and_image() {
        let (_t, r) = root();
        std::fs::write(format!("{r}/bin"), [b'a', 0, b'b']).unwrap();
        let c = read_file(&LocalTransport, &r, "bin").await.unwrap();
        assert!(matches!(c.kind, ContentKind::Binary));
        assert_eq!(c.text, None);
        assert_eq!(c.size, 3);

        std::fs::write(format!("{r}/big.txt"), vec![b'x'; MAX_TEXT_BYTES + 10]).unwrap();
        let c = read_file(&LocalTransport, &r, "big.txt").await.unwrap();
        assert!(c.truncated);
        assert_eq!(c.text.unwrap().len(), MAX_TEXT_BYTES);
        assert_eq!(c.size, (MAX_TEXT_BYTES + 10) as u64);

        std::fs::write(format!("{r}/p.png"), [0x89, b'P', b'N', b'G', 0]).unwrap();
        let c = read_file(&LocalTransport, &r, "p.png").await.unwrap();
        assert!(matches!(c.kind, ContentKind::Image));
        assert_eq!(
            read_image(&LocalTransport, &r, "p.png").await.unwrap(),
            vec![0x89, b'P', b'N', b'G', 0]
        );
    }

    #[tokio::test]
    async fn a_pdf_is_its_own_kind_and_reads_whole() {
        let (_t, r) = root();
        std::fs::write(format!("{r}/a.pdf"), b"%PDF-1.4\n\0bin").unwrap();
        let c = read_file(&LocalTransport, &r, "a.pdf").await.unwrap();
        assert!(matches!(c.kind, ContentKind::Pdf));
        assert_eq!((c.text, c.editable, c.size), (None, false, 13));
        assert_eq!(
            read_pdf(&LocalTransport, &r, "a.pdf").await.unwrap(),
            b"%PDF-1.4\n\0bin".to_vec()
        );
    }

    #[tokio::test]
    async fn a_pdf_may_be_larger_than_an_image_but_not_unbounded() {
        let (_t, r) = root();
        std::fs::write(format!("{r}/ok.pdf"), vec![0u8; MAX_IMAGE_BYTES + 1]).unwrap();
        assert_eq!(
            read_pdf(&LocalTransport, &r, "ok.pdf").await.unwrap().len(),
            MAX_IMAGE_BYTES + 1
        );
        std::fs::write(format!("{r}/huge.pdf"), vec![0u8; MAX_PDF_BYTES + 1]).unwrap();
        let e = read_pdf(&LocalTransport, &r, "huge.pdf").await.unwrap_err();
        assert_eq!(
            (e.code.as_str(), e.message.as_str()),
            ("invalid", "PDF larger than 20 MB")
        );
    }

    #[tokio::test]
    async fn too_large_image_is_refused() {
        let (_t, r) = root();
        std::fs::write(format!("{r}/huge.png"), vec![0u8; MAX_IMAGE_BYTES + 1]).unwrap();
        let e = read_image(&LocalTransport, &r, "huge.png")
            .await
            .unwrap_err();
        assert_eq!(
            (e.code.as_str(), e.message.as_str()),
            ("invalid", "image larger than 5 MB")
        );
    }

    #[tokio::test]
    async fn missing_is_not_found() {
        let (_t, r) = root();
        std::fs::write(format!("{r}/a"), "abc").unwrap();
        assert_eq!(
            read_file(&LocalTransport, &r, "nope")
                .await
                .unwrap_err()
                .code,
            "not_found"
        );
    }

    #[tokio::test]
    async fn a_folder_is_is_dir_not_missing() {
        let (_t, r) = root();
        let e = read_file(&LocalTransport, &r, "src").await.unwrap_err();
        assert_eq!(e.code, "is_dir");
        let e = read_image(&LocalTransport, &r, "src").await.unwrap_err();
        assert_eq!(e.code, "is_dir");
    }

    #[tokio::test]
    async fn symlinks_report_their_target() {
        let (_t, r) = root();
        std::fs::write(format!("{r}/huge.png"), vec![0u8; MAX_IMAGE_BYTES + 1]).unwrap();
        std::os::unix::fs::symlink("huge.png", format!("{r}/link.png")).unwrap();
        let e = read_image(&LocalTransport, &r, "link.png")
            .await
            .unwrap_err();
        assert_eq!(e.code, "invalid");

        std::fs::write(format!("{r}/big.txt"), vec![b'x'; MAX_TEXT_BYTES + 10]).unwrap();
        std::os::unix::fs::symlink("big.txt", format!("{r}/link.txt")).unwrap();
        let c = read_file(&LocalTransport, &r, "link.txt").await.unwrap();
        assert!(c.truncated);
        assert_eq!(c.size, (MAX_TEXT_BYTES + 10) as u64);
    }

    #[test]
    fn a_cut_utf8_sequence_is_dropped() {
        let s = "aé€😀".as_bytes(); // 1 + 2 + 3 + 4 bytes
        assert_eq!(drop_partial_utf8(s), s);
        for cut in [2usize, 4, 5, 7, 8, 9] {
            let got = drop_partial_utf8(&s[..cut]);
            assert!(std::str::from_utf8(got).is_ok(), "{cut}");
        }
        assert_eq!(drop_partial_utf8(&s[..2]), b"a");
        assert_eq!(drop_partial_utf8(&s[..9]), "aé€".as_bytes());
        assert_eq!(drop_partial_utf8(b""), b"");
        // A stray continuation byte is left for from_utf8_lossy.
        assert_eq!(drop_partial_utf8(&[b'a', 0x80, 0x80, 0x80, 0x80]).len(), 5);
    }

    #[tokio::test]
    async fn truncated_text_ends_on_a_whole_character() {
        let (_t, r) = root();
        let mut big = vec![b'x'; MAX_TEXT_BYTES - 1];
        big.extend("é and more".as_bytes());
        std::fs::write(format!("{r}/u.txt"), &big).unwrap();
        let c = read_file(&LocalTransport, &r, "u.txt").await.unwrap();
        assert!(c.truncated);
        let text = c.text.unwrap();
        assert!(!text.ends_with('\u{FFFD}'));
        assert_eq!(text.len(), MAX_TEXT_BYTES - 1);
    }

    #[tokio::test]
    async fn text_that_changed_size_while_read_is_not_editable() {
        // Stat said 5 bytes, then the file grew (or shrank) before `head` read it: what was
        // read is not the version stat describes, so saving it back must not be offered.
        use crate::files::Canned;
        for out in ["printf '5 9\\n0\\nhello world'", "printf '5 9\\n0\\nhel'"] {
            let c = read_file(&Canned(out), "/r", "a.txt").await.unwrap();
            assert!(!c.editable && c.cksum.is_none(), "{out}");
        }
        let c = read_file(&Canned("printf '5 9\\n0\\nhello'"), "/r", "a.txt")
            .await
            .unwrap();
        assert!(c.editable && c.cksum.is_some());
    }

    #[tokio::test]
    async fn odd_script_output_is_an_io_error() {
        use crate::files::Canned;
        let e = read_file(&Canned("printf '3 4\\nx\\nhello'"), "/r", "a.txt")
            .await
            .unwrap_err();
        assert_eq!(e.message, bad_output().message);
        let e = read_image(&Canned("printf 'x 4\\n'; exit 5"), "/r", "a.png")
            .await
            .unwrap_err();
        assert_eq!(
            (e.code.as_str(), e.message.as_str()),
            ("io", bad_output().message.as_str())
        );
        let e = read_file(&Canned("exit 9"), "/r", "a.txt")
            .await
            .unwrap_err();
        assert_eq!((e.code.as_str(), e.message.as_str()), ("io", "exit 9"));
    }
}
