//! Remote transcripts kept on this Mac, so reopening one fetches only what was appended.
//!
//! A cached copy is the file's first bytes. The Machine checks it still is by comparing the
//! `cksum` of the copy's last `WINDOW` bytes with its own bytes at the same place.
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Bytes at the end of a cached copy that the Machine checks.
pub const WINDOW: usize = 4096;
/// What the cache may hold before the oldest copies are removed at startup.
pub const BUDGET: u64 = 500 * 1024 * 1024;

static DIR: OnceLock<PathBuf> = OnceLock::new();

/// Call once at startup: where cached copies live. Without it nothing is cached.
pub fn use_dir(dir: PathBuf) {
    let _ = DIR.set(dir);
}

/// The cached copy of one transcript on one Machine.
#[derive(Clone, Debug)]
pub struct Slot {
    file: PathBuf,
}

impl Slot {
    /// The slot for `path` on `machine_id`, if a cache directory was set.
    pub fn for_transcript(machine_id: &str, path: &str) -> Option<Slot> {
        DIR.get().map(|d| Slot::in_dir(d, machine_id, path))
    }

    pub fn in_dir(dir: &Path, machine_id: &str, path: &str) -> Slot {
        let key = fnv1a64(&format!("{machine_id}\0{path}"));
        Slot {
            file: dir.join(format!("{key:016x}.jsonl")),
        }
    }

    /// The cached bytes; empty when there are none.
    pub fn load(&self) -> Vec<u8> {
        std::fs::read(&self.file).unwrap_or_default()
    }

    /// Replaces the cached copy with `bytes`, atomically: a reader sees the old copy or the new.
    pub fn store(&self, bytes: &[u8]) -> std::io::Result<()> {
        let dir = self.file.parent().unwrap_or(Path::new("."));
        std::fs::create_dir_all(dir)?;
        let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
        std::io::Write::write_all(&mut tmp, bytes)?;
        tmp.persist(&self.file).map_err(|e| e.error)?;
        Ok(())
    }
}

/// What the Machine's `cksum` prints for the last `WINDOW` bytes of `bytes`: `"<crc> <len>"`.
pub fn window_cksum(bytes: &[u8]) -> String {
    let w = &bytes[bytes.len().saturating_sub(WINDOW)..];
    format!("{} {}", cksum(w), w.len())
}

/// POSIX `cksum`: CRC-32 (polynomial 0x04C11DB7, MSB first) over the bytes, then the length.
pub fn cksum(bytes: &[u8]) -> u32 {
    fn feed(mut crc: u32, b: u8) -> u32 {
        crc ^= (b as u32) << 24;
        for _ in 0..8 {
            crc = if crc & 0x8000_0000 != 0 {
                (crc << 1) ^ 0x04C1_1DB7
            } else {
                crc << 1
            };
        }
        crc
    }
    let mut crc = 0u32;
    for &b in bytes {
        crc = feed(crc, b);
    }
    let mut len = bytes.len();
    while len > 0 {
        crc = feed(crc, (len & 0xff) as u8);
        len >>= 8;
    }
    !crc
}

/// Removes the least recently written copies until the rest fit in `budget` bytes.
pub fn prune(dir: &Path, budget: u64) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = Vec::new();
    for e in rd.flatten() {
        let Ok(m) = e.metadata() else { continue };
        if !m.is_file() {
            continue;
        }
        let when = m.modified().unwrap_or(std::time::UNIX_EPOCH);
        files.push((when, m.len(), e.path()));
    }
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    files.sort();
    for (_, len, path) in files {
        if total <= budget {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total -= len;
        }
    }
}

fn fnv1a64(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    fn system_cksum(bytes: &[u8]) -> String {
        use std::io::Write;
        let mut c = std::process::Command::new("cksum")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        c.stdin.take().unwrap().write_all(bytes).unwrap();
        String::from_utf8(c.wait_with_output().unwrap().stdout)
            .unwrap()
            .trim()
            .to_string()
    }

    #[test]
    fn window_cksum_matches_the_cksum_tool() {
        let big: Vec<u8> = (0..10_000u32).map(|i| (i * 7 % 251) as u8).collect();
        for bytes in [&b""[..], b"abc", &big[..300], &big] {
            let w = &bytes[bytes.len().saturating_sub(WINDOW)..];
            assert_eq!(window_cksum(bytes), system_cksum(w), "len {}", bytes.len());
        }
    }

    #[test]
    fn a_stored_copy_loads_back_and_a_missing_one_is_empty() {
        let d = tempfile::tempdir().unwrap();
        let s = Slot::in_dir(&d.path().join("t"), "m", "/a.jsonl");
        assert!(s.load().is_empty());
        s.store(b"one\n").unwrap();
        s.store(b"one\ntwo\n").unwrap();
        assert_eq!(s.load(), b"one\ntwo\n");
        let other = Slot::in_dir(&d.path().join("t"), "n", "/a.jsonl");
        assert!(
            other.load().is_empty(),
            "another Machine's file shares the slot"
        );
    }

    #[test]
    fn prune_removes_the_oldest_until_the_rest_fit() {
        let d = tempfile::tempdir().unwrap();
        let now = std::time::SystemTime::now();
        for (i, name) in ["old", "mid", "new"].iter().enumerate() {
            let p = d.path().join(name);
            std::fs::write(&p, [0u8; 10]).unwrap();
            let f = std::fs::File::options().write(true).open(&p).unwrap();
            f.set_modified(now - std::time::Duration::from_secs(100 - i as u64 * 10))
                .unwrap();
        }
        prune(d.path(), 20);
        let mut left: Vec<_> = std::fs::read_dir(d.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left, ["mid", "new"]);
    }
}
