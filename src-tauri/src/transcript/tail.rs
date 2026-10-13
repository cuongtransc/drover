//! Stream a transcript file with `tail -F` on the Machine and feed a parser.
use super::cache;
use super::images::{ImageSink, ImageStore, IMAGE_BUDGET, PARKED_IMAGE_BUDGET};
use super::{ChatEvent, ChatItem, ChatMeta, Parser, ParserOutput};
use crate::error::AppError;
use crate::transport::Transport;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::task::JoinHandle;

const BATCH: Duration = Duration::from_millis(50);
const RESET_ITEMS: usize = 500;
/// Silence that ends the first backlog when the size header is unreadable.
const QUIET: Duration = if cfg!(test) {
    Duration::from_secs(1)
} else {
    Duration::from_secs(2)
};
const MAX_LINE: usize = 32 * 1024 * 1024;
/// An open that takes this long to its first Reset is logged, with where the time went.
const SLOW_OPEN: Duration = Duration::from_millis(500);

pub type Sink = Arc<dyn Fn(ChatEvent) + Send + Sync>;

/// How the backlog crosses the wire. The Machine falls back from zstd to gzip to raw when a
/// tool is missing, and says in the header which it used.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Codec {
    #[default]
    Raw,
    Gzip,
    Zstd,
}

impl Codec {
    fn name(self) -> &'static str {
        match self {
            Codec::Raw => "raw",
            Codec::Gzip => "gzip",
            Codec::Zstd => "zstd",
        }
    }

    fn parse(s: &str) -> Option<Codec> {
        match s {
            "raw" => Some(Codec::Raw),
            "gzip" => Some(Codec::Gzip),
            "zstd" => Some(Codec::Zstd),
            _ => None,
        }
    }

    fn decode(self, bytes: &[u8]) -> std::io::Result<Vec<u8>> {
        match self {
            Codec::Raw => Ok(bytes.to_vec()),
            Codec::Zstd => zstd::stream::decode_all(bytes),
            Codec::Gzip => {
                let mut out = Vec::new();
                std::io::Read::read_to_end(&mut flate2::read::GzDecoder::new(bytes), &mut out)?;
                Ok(out)
            }
        }
    }
}

/// How a tail gets its backlog: from a cached copy plus what was appended, and compressed.
#[derive(Clone, Debug, Default)]
pub struct Fetch {
    pub cache: Option<cache::Slot>,
    pub codec: Codec,
}

impl Fetch {
    /// A Machine over ssh caches and compresses; the local Machine reads its own disk.
    pub fn for_machine(machine_id: &str, path: &str) -> Fetch {
        if machine_id == crate::machines::LOCAL {
            return Fetch::default();
        }
        Fetch {
            cache: cache::Slot::for_transcript(machine_id, path),
            codec: Codec::Zstd,
        }
    }
}

/// Where a tail's events go. `sink` is None while the tail is parked; `attach` leaves the
/// new sink in `pending` for the parse thread to adopt, so attaching never blocks.
struct Link {
    sink: Option<Sink>,
    pending: Option<Sink>,
}

type SharedLink = Arc<Mutex<Link>>;

/// Sends `ev` to the current sink, if any. The sink is cloned out so it runs unlocked.
fn emit(link: &SharedLink, ev: ChatEvent) {
    let sink = link.lock().unwrap().sink.clone();
    if let Some(sink) = sink {
        sink(ev);
    }
}

/// A running tail. Dropping it ends the `tail` process.
pub struct TailHandle {
    items: Arc<Mutex<Vec<ChatItem>>>,
    images: Arc<Mutex<ImageStore>>,
    link: SharedLink,
    task: JoinHandle<()>,
    /// Set once the parse thread is gone: past that, nothing reaches a sink.
    done: Arc<AtomicBool>,
}

impl TailHandle {
    /// The last `limit` items whose absolute index is `< before`.
    pub fn page(&self, before: usize, limit: usize) -> Vec<ChatItem> {
        let items = self.items.lock().unwrap();
        let end = before.min(items.len());
        items[end.saturating_sub(limit)..end].to_vec()
    }

    /// Parks the tail: it keeps reading but emits nothing, and keeps fewer images.
    pub fn detach(&self) {
        {
            let mut link = self.link.lock().unwrap();
            link.sink = None;
            link.pending = None;
        }
        self.images.lock().unwrap().set_budget(PARKED_IMAGE_BUDGET);
    }

    /// Sends later events to `sink`, starting with a Reset of what the tail kept. The
    /// parse thread takes it over within a tick (50 ms).
    pub fn attach(&self, sink: Sink) {
        self.images.lock().unwrap().set_budget(IMAGE_BUDGET);
        self.link.lock().unwrap().pending = Some(sink);
    }

    /// Whether the tail still delivers: the parse thread is up and the reader has not
    /// finished. The reader can outlive the parse thread briefly after an Eof.
    pub fn is_running(&self) -> bool {
        !self.done.load(Ordering::Acquire) && !self.task.is_finished()
    }

    /// The tail's image store, shared: lock it after letting go of any other lock.
    pub fn images(&self) -> Arc<Mutex<ImageStore>> {
        self.images.clone()
    }
}

impl Drop for TailHandle {
    fn drop(&mut self) {
        // Aborting drops the future, closing the child's stdin; the wrapper then kills tail.
        self.task.abort();
    }
}

struct State {
    items: Arc<Mutex<Vec<ChatItem>>>,
    images: Arc<Mutex<ImageStore>>,
    /// The Model and Reasoning effort last sent to the sink.
    last_meta: ChatMeta,
    parser: Box<dyn Parser>,
    link: SharedLink,
    /// Events of the current batch, in order.
    events: Vec<ChatEvent>,
    /// Items appended since the last event was queued.
    appended: Vec<ChatItem>,
    sent_first: bool,
    /// The file's size when the tail started, from the header line.
    size: Option<u64>,
    /// Bytes of the stream read after the header.
    consumed: u64,
    /// When the last byte arrived; None until the first.
    last_byte: Option<Instant>,
    /// For the slow-open log: the file, how its backlog was fetched, when the tail started,
    /// and the time spent parsing the backlog.
    path: String,
    fetched: Option<Header>,
    began: Instant,
    parse_time: Duration,
    /// Dropped with the State, so any end of the parse thread (Eof, closed channel, panic,
    /// failed spawn) marks the tail done.
    _done: DoneOnDrop,
}

struct DoneOnDrop(Arc<AtomicBool>);

impl Drop for DoneOnDrop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}

/// The log line for an open that took `took` to its first Reset, if that is slow.
fn slow_open(
    took: Duration,
    parse: Duration,
    bytes: u64,
    items: usize,
    fetched: Option<&Header>,
) -> Option<String> {
    if took < SLOW_OPEN {
        return None;
    }
    let ms = |d: Duration| d.as_millis();
    let how = match fetched {
        Some(h) => format!(
            ", {} bytes cached, {} bytes fetched {}",
            h.from,
            h.len,
            h.codec.name()
        ),
        None => String::new(),
    };
    Some(format!(
        "{} ms to the first Reset: {bytes} bytes, {items} items, {} ms parsing, {} ms reading{how}",
        ms(took),
        ms(parse),
        ms(took.saturating_sub(parse))
    ))
}

/// The first line the Machine sends: `<size> <from> <len> <codec>`. The backlog is the file's
/// first `size` bytes: `from` of them are the cached copy's, the rest follow as `len` bytes
/// in `codec`.
#[derive(Clone, Debug, PartialEq)]
struct Header {
    size: u64,
    from: u64,
    len: u64,
    codec: Codec,
}

fn parse_header(line: &[u8]) -> Option<Header> {
    let mut f = std::str::from_utf8(line).ok()?.split_whitespace();
    let h = Header {
        size: f.next()?.parse().ok()?,
        from: f.next()?.parse().ok()?,
        len: f.next()?.parse().ok()?,
        codec: Codec::parse(f.next()?)?,
    };
    if f.next().is_some() || h.from > h.size {
        return None;
    }
    Some(h)
}

impl State {
    fn reset_event(items: &[ChatItem]) -> ChatEvent {
        ChatEvent::Reset {
            items: items[items.len().saturating_sub(RESET_ITEMS)..].to_vec(),
            total: items.len(),
        }
    }

    fn line(&mut self, line: &str) {
        // Parse into a local list so the store is locked only to put, never during a parse.
        let mut found: Vec<(String, String, Vec<u8>)> = Vec::new();
        let began = Instant::now();
        let out = self.parser.push_line(line, &mut found);
        if !self.sent_first {
            self.parse_time += began.elapsed();
        }
        if !found.is_empty() {
            let mut images = self.images.lock().unwrap();
            for (r, media_type, bytes) in found {
                images.put(r, media_type, bytes);
            }
        }
        match out {
            ParserOutput::None => {}
            ParserOutput::Append(v) => {
                // Before the first Reset, `items` is all that is needed: that Reset snapshots it.
                if self.sent_first {
                    self.appended.extend(v.iter().cloned());
                }
                self.items.lock().unwrap().extend(v);
            }
            ParserOutput::Reset(v) => {
                if !self.appended.is_empty() {
                    self.events.push(ChatEvent::Append {
                        items: std::mem::take(&mut self.appended),
                    });
                }
                let mut items = self.items.lock().unwrap();
                *items = v;
                self.events.push(Self::reset_event(&items));
            }
            ParserOutput::Truncate { keep, items: v } => {
                // A Reset replaces the whole list, so Appends not sent yet need not be.
                self.appended.clear();
                let mut items = self.items.lock().unwrap();
                items.truncate(keep);
                items.extend(v);
                self.events.push(Self::reset_event(&items));
            }
        }
    }

    fn flush(&mut self) {
        if !self.sent_first {
            // Wait until the backlog's bytes have all been read (or, with no usable size,
            // the stream goes quiet), then send one Reset covering everything. A known size
            // waits for its bytes however long a pause: silence would send part of it.
            let caught_up = match self.size {
                Some(s) => self.consumed >= s,
                None => self.last_byte.is_some_and(|t| t.elapsed() >= QUIET),
            };
            if !caught_up {
                return;
            }
            let ev = Self::reset_event(&self.items.lock().unwrap());
            if let ChatEvent::Reset { total, .. } = &ev {
                let bytes = self.size.unwrap_or(self.consumed);
                let took = self.began.elapsed();
                if let Some(line) =
                    slow_open(took, self.parse_time, bytes, *total, self.fetched.as_ref())
                {
                    tracing::warn!("chat open slow: {}: {line}", self.path);
                }
            }
            self.events.clear();
            self.appended.clear();
            self.sent_first = true;
            emit(&self.link, ev);
            self.send_meta_if_changed();
            return;
        }
        if !self.appended.is_empty() {
            self.events.push(ChatEvent::Append {
                items: std::mem::take(&mut self.appended),
            });
        }
        for ev in self.events.drain(..) {
            emit(&self.link, ev);
        }
        self.send_meta_if_changed();
    }

    fn send_meta_if_changed(&mut self) {
        let meta = self.parser.meta();
        if meta != self.last_meta {
            self.last_meta = meta.clone();
            emit(
                &self.link,
                ChatEvent::Meta {
                    model: meta.model,
                    effort: meta.effort,
                    context_tokens: meta.context_tokens,
                    queued: meta.queued,
                    alias: meta.alias,
                    background: meta.background,
                },
            );
        }
    }

    /// Moves a pending sink in. What was queued for the old sink is dropped: the Reset
    /// below covers it. Before the first Reset there is nothing more to do, as that
    /// Reset goes to the new sink.
    fn adopt_pending(&mut self) {
        {
            let mut link = self.link.lock().unwrap();
            let Some(s) = link.pending.take() else { return };
            link.sink = Some(s);
        }
        self.events.clear();
        self.appended.clear();
        if self.sent_first {
            let ev = Self::reset_event(&self.items.lock().unwrap());
            emit(&self.link, ev);
            self.last_meta = ChatMeta::default();
            self.send_meta_if_changed();
        }
    }
}

pub fn spawn_tail(
    t: Arc<dyn Transport>,
    path: String,
    parser: Box<dyn Parser>,
    sink: Sink,
) -> TailHandle {
    spawn_tail_with(t, path, Fetch::default(), parser, sink)
}

pub fn spawn_tail_with(
    t: Arc<dyn Transport>,
    path: String,
    fetch: Fetch,
    parser: Box<dyn Parser>,
    sink: Sink,
) -> TailHandle {
    let items: Arc<Mutex<Vec<ChatItem>>> = Arc::default();
    let images = Arc::new(Mutex::new(ImageStore::new(IMAGE_BUDGET)));
    let done: Arc<AtomicBool> = Arc::default();
    let state = State {
        items: items.clone(),
        images: images.clone(),
        last_meta: ChatMeta::default(),
        parser,
        link: Arc::new(Mutex::new(Link {
            sink: Some(sink),
            pending: None,
        })),
        events: Vec::new(),
        appended: Vec::new(),
        sent_first: false,
        size: None,
        consumed: 0,
        last_byte: None,
        path: path.clone(),
        fetched: None,
        began: Instant::now(),
        parse_time: Duration::ZERO,
        _done: DoneOnDrop(done.clone()),
    };
    let link = state.link.clone();
    let (tx, rx) = tokio::sync::mpsc::channel(16);
    // Parsing is CPU-bound (lines reach 32 MiB), so it gets a thread of its own. It ends
    // when the reader is aborted and the channel closes.
    let spawned = std::thread::Builder::new()
        .name("chat-parse".into())
        .spawn(move || parse_loop(state, rx));
    if let Err(e) = spawned {
        emit(
            &link,
            ChatEvent::Error {
                error: AppError::new("io", e.to_string()),
            },
        );
    }
    let task = tokio::spawn(read(t, path, fetch, link.clone(), tx));
    TailHandle {
        items,
        images,
        link,
        task,
        done,
    }
}

/// What the reader tells the parse thread.
enum Msg {
    /// The header line, parsed.
    Header(Option<Header>),
    /// One line, without its newline.
    Line(Vec<u8>),
    /// Raw bytes read after the header, sent once the chunk's lines are.
    Bytes(usize),
    Tick,
    /// The tail's output ended.
    Eof,
}

fn parse_loop(mut st: State, mut rx: tokio::sync::mpsc::Receiver<Msg>) {
    while let Some(m) = rx.blocking_recv() {
        st.adopt_pending();
        match m {
            Msg::Header(h) => {
                st.size = h.as_ref().map(|h| h.size);
                st.fetched = h;
                st.last_byte = Some(Instant::now());
            }
            Msg::Line(mut bytes) => {
                if bytes.last() == Some(&b'\r') {
                    bytes.pop();
                }
                st.line(&String::from_utf8_lossy(&bytes));
            }
            Msg::Bytes(n) => {
                st.consumed += n as u64;
                st.last_byte = Some(Instant::now());
            }
            Msg::Tick => st.flush(),
            Msg::Eof => {
                st.flush();
                emit(
                    &st.link,
                    ChatEvent::Error {
                        error: AppError::new("io", "transcript tail exited"),
                    },
                );
                return;
            }
        }
    }
}

/// The remote script: `$1` the file, `$2` the cached copy's size (0 for none), `$3` the
/// `cksum` of its last bytes, `$4` the codec to try. It prints the header, the backlog
/// after the cached part, then follows the file.
///
/// The backlog comes from `head`, and `tail` follows from the byte after it: macOS's
/// `tail -c +1` reads ~28 MB/s, which made a 50 MB transcript take 1.8 s to open. It ends
/// (and kills tail) when its stdin reaches EOF, i.e. when the handle drops: closing stdin
/// is the only reliable cleanup over ssh without a tty.
const SCRIPT: &str = r#"f=$1 c=$2 k=$3 z=$4
s=$(wc -c < "$f" 2>/dev/null) || s=0; s=$((s + 0)); from=0
if [ "$c" -gt 0 ] && [ "$s" -ge "$c" ]; then
  w=4096; [ "$c" -lt "$w" ] && w=$c
  [ "$(tail -c +$((c - w + 1)) "$f" 2>/dev/null | head -c "$w" | cksum)" = "$k" ] && from=$c
fi
n=$((s - from))
part() { if [ "$from" -gt 0 ]; then tail -c +$((from + 1)) "$f" 2>/dev/null | head -c "$n"; else head -c "$n" "$f" 2>/dev/null; fi; }
[ "$z" = zstd ] && ! command -v zstd >/dev/null 2>&1 && z=gzip
[ "$z" = gzip ] && ! command -v gzip >/dev/null 2>&1 && z=raw
[ "$n" -gt 0 ] || z=raw
t=
if [ "$z" != raw ]; then t=$(mktemp 2>/dev/null) || z=raw; fi
if [ "$z" = zstd ]; then part | zstd -q -3 -c > "$t" || z=raw; fi
if [ "$z" = gzip ]; then part | gzip -1 -c > "$t" || z=raw; fi
if [ "$z" = raw ]; then echo "$s $from $n raw"; part; else l=$(wc -c < "$t"); echo "$s $from $((l + 0)) $z"; cat "$t"; fi
[ -n "$t" ] && rm -f "$t"
tail -c +$((s + 1)) -F "$f" & p=$!; cat >/dev/null; kill $p 2>/dev/null"#;

/// Splits the stream into lines for the parse thread.
#[derive(Default)]
struct Splitter {
    buf: Vec<u8>,
    dropping: bool,
}

impl Splitter {
    /// Sends `data`'s complete lines, then its size. False once the parse thread is gone.
    async fn feed(&mut self, data: &[u8], tx: &tokio::sync::mpsc::Sender<Msg>) -> bool {
        for part in data.split_inclusive(|b| *b == b'\n') {
            if !self.dropping {
                self.buf
                    .extend_from_slice(part.strip_suffix(b"\n").unwrap_or(part));
                if self.buf.len() > MAX_LINE {
                    self.dropping = true;
                    self.buf.clear();
                }
            }
            if part.ends_with(b"\n") {
                if !self.dropping
                    && tx
                        .send(Msg::Line(std::mem::take(&mut self.buf)))
                        .await
                        .is_err()
                {
                    return false;
                }
                self.dropping = false;
                self.buf.clear();
            }
        }
        // Sent even when 0, so a header still arriving starts the quiet clock.
        tx.send(Msg::Bytes(data.len())).await.is_ok()
    }
}

enum Phase {
    /// The header line so far.
    Header(Vec<u8>),
    /// The fetched part of the backlog so far.
    Backlog(Header, Vec<u8>),
    /// Lines from `tail -F` (or everything after an unreadable header).
    Follow,
}

async fn read(
    t: Arc<dyn Transport>,
    path: String,
    fetch: Fetch,
    link: SharedLink,
    tx: tokio::sync::mpsc::Sender<Msg>,
) {
    let slot = fetch.cache.clone();
    let cached = match slot.clone() {
        Some(s) => tokio::task::spawn_blocking(move || s.load())
            .await
            .unwrap_or_default(),
        None => Vec::new(),
    };
    let (c, k) = if cached.is_empty() {
        ("0".to_string(), "0".to_string())
    } else {
        (cached.len().to_string(), cache::window_cksum(&cached))
    };
    let argv = t.wrap(
        &[
            "sh".into(),
            "-c".into(),
            SCRIPT.into(),
            "sh".into(),
            path.clone(),
            c,
            k,
            fetch.codec.name().into(),
        ],
        false,
    );
    let spawned = Command::new(&argv[0])
        .args(&argv[1..])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => {
            emit(&link, ChatEvent::Error { error: e.into() });
            return;
        }
    };
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let _stdin = child.stdin.take();
    let mut tick = tokio::time::interval_at(tokio::time::Instant::now() + BATCH, BATCH);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut chunk = vec![0u8; 64 * 1024];
    let mut lines = Splitter::default();
    let mut phase = Phase::Header(Vec::new());
    let mut cached = Some(cached);
    loop {
        tokio::select! {
            n = stdout.read(&mut chunk) => {
                let n = match n { Ok(0) | Err(_) => break, Ok(n) => n };
                let mut data = &chunk[..n];
                if let Phase::Header(h) = &mut phase {
                    let Some(i) = data.iter().position(|b| *b == b'\n') else {
                        h.extend_from_slice(data);
                        if tx.send(Msg::Bytes(0)).await.is_err() { return; }
                        continue;
                    };
                    h.extend_from_slice(&data[..i]);
                    data = &data[i + 1..];
                    let header = parse_header(h);
                    if tx.send(Msg::Header(header.clone())).await.is_err() { return; }
                    phase = match header {
                        Some(h) => {
                            let cap = usize::try_from(h.len).unwrap_or(0).min(MAX_LINE);
                            Phase::Backlog(h, Vec::with_capacity(cap))
                        }
                        None => Phase::Follow,
                    };
                }
                if let Phase::Backlog(h, got) = &mut phase {
                    let want = usize::try_from(h.len).unwrap_or(usize::MAX) - got.len();
                    let take = want.min(data.len());
                    got.extend_from_slice(&data[..take]);
                    data = &data[take..];
                    if (got.len() as u64) < h.len {
                        if tx.send(Msg::Bytes(0)).await.is_err() { return; }
                        continue;
                    }
                    let h = h.clone();
                    let wire = std::mem::take(got);
                    let mine = cached.take().unwrap_or_default();
                    let backlog = match backlog(&h, mine, wire).await {
                        Ok(b) => b,
                        Err(e) => {
                            emit(&link, ChatEvent::Error { error: AppError::new("io", e) });
                            return;
                        }
                    };
                    if let Some(s) = slot.clone() {
                        // Unchanged since the cached copy: nothing to write.
                        if h.from < h.size {
                            let b = backlog.clone();
                            let path = path.clone();
                            tokio::task::spawn_blocking(move || {
                                if let Err(e) = s.store(&b) {
                                    tracing::warn!("chat cache write failed: {path}: {e}");
                                }
                            });
                        }
                    }
                    if !lines.feed(&backlog, &tx).await { return; }
                    phase = Phase::Follow;
                }
                if !lines.feed(data, &tx).await { return; }
            }
            _ = tick.tick() => {
                if tx.send(Msg::Tick).await.is_err() { return; }
            }
        }
    }
    let _ = tx.send(Msg::Eof).await;
}

/// The file's first `h.size` bytes: the cached copy's first `h.from`, then `wire` decoded.
async fn backlog(h: &Header, mut cached: Vec<u8>, wire: Vec<u8>) -> Result<Vec<u8>, String> {
    let codec = h.codec;
    let fetched = tokio::task::spawn_blocking(move || codec.decode(&wire))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("transcript {} backlog: {e}", codec.name()))?;
    let from = usize::try_from(h.from).map_err(|e| e.to_string())?;
    if from > cached.len() {
        return Err(format!(
            "transcript cache: the Machine kept {from} bytes of a {}-byte copy",
            cached.len()
        ));
    }
    cached.truncate(from);
    cached.extend_from_slice(&fetched);
    Ok(cached)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::images::ImageSink;
    use std::sync::{Arc, Mutex};
    /// Polls `cond` for up to ~10 s: fixed 500 ms waits failed under a busy gate (load 154).
    async fn wait_for(cond: impl Fn() -> bool) {
        for _ in 0..334 {
            if cond() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
        panic!("timed out");
    }
    fn any_event(got: &Mutex<Vec<ChatEvent>>) -> bool {
        !got.lock().unwrap().is_empty()
    }
    /// Each event as its kind and size, for a failed assertion.
    fn summary(got: &Mutex<Vec<ChatEvent>>) -> Vec<String> {
        got.lock()
            .unwrap()
            .iter()
            .map(|e| match e {
                ChatEvent::Reset { items, total } => format!("Reset {}/{total}", items.len()),
                ChatEvent::Append { items } => format!("Append {}", items.len()),
                other => format!("{other:?}").chars().take(40).collect(),
            })
            .collect()
    }
    fn any_append(got: &Mutex<Vec<ChatEvent>>) -> bool {
        got.lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, ChatEvent::Append { .. }))
    }
    struct Lines;
    impl Parser for Lines {
        fn push_line(&mut self, line: &str, _images: &mut dyn ImageSink) -> ParserOutput {
            if line == "RESET" {
                ParserOutput::Reset(vec![ChatItem::System {
                    ts: None,
                    task: None,
                    text: "reset".into(),
                }])
            } else {
                ParserOutput::Append(vec![ChatItem::User {
                    images: vec![],
                    skills: vec![],
                    ts: None,
                    text: line.into(),
                }])
            }
        }
    }
    struct MetaLines {
        model: Option<String>,
    }
    impl Parser for MetaLines {
        fn push_line(&mut self, line: &str, images: &mut dyn ImageSink) -> ParserOutput {
            if let Some(m) = line.strip_prefix("MODEL ") {
                self.model = Some(m.into());
                return ParserOutput::None;
            }
            if let Some(r) = line.strip_prefix("IMG ") {
                images.put(r.into(), "image/png".into(), vec![7, 7]);
                return ParserOutput::None;
            }
            ParserOutput::Append(vec![ChatItem::User {
                ts: None,
                text: line.into(),
                images: vec![],
                skills: vec![],
            }])
        }
        fn meta(&self) -> crate::transcript::ChatMeta {
            crate::transcript::ChatMeta {
                model: self.model.clone(),
                ..Default::default()
            }
        }
    }

    /// Blocks inside `push_line` until released, reporting when it got there.
    struct Stuck {
        entered: std::sync::mpsc::Sender<()>,
        release: std::sync::mpsc::Receiver<()>,
    }
    impl Parser for Stuck {
        fn push_line(&mut self, _: &str, images: &mut dyn ImageSink) -> ParserOutput {
            self.entered.send(()).unwrap();
            self.release.recv().unwrap();
            images.put("r".into(), "image/png".into(), vec![1]);
            ParserOutput::None
        }
    }

    #[test]
    fn a_slow_open_is_logged_with_where_the_time_went() {
        let ms = Duration::from_millis;
        assert_eq!(slow_open(ms(499), ms(100), 1_000, 10, None), None);
        assert_eq!(
            slow_open(ms(1931), ms(101), 50_910_806, 7985, None).as_deref(),
            Some("1931 ms to the first Reset: 50910806 bytes, 7985 items, 101 ms parsing, 1830 ms reading")
        );
        let h = Header {
            size: 8_319_778,
            from: 7_755_017,
            len: 98_304,
            codec: Codec::Zstd,
        };
        assert_eq!(
            slow_open(ms(600), ms(50), h.size, 867, Some(&h)).as_deref(),
            Some("600 ms to the first Reset: 8319778 bytes, 867 items, 50 ms parsing, 550 ms reading, 7755017 bytes cached, 98304 bytes fetched zstd")
        );
    }

    /// Runs the command with a `tail` shim first on PATH that records its arguments.
    struct ShimTail(std::path::PathBuf);
    #[async_trait::async_trait]
    impl Transport for ShimTail {
        fn wrap(&self, argv: &[String], _: bool) -> Vec<String> {
            let path = format!(
                "PATH={}:{}",
                self.0.display(),
                std::env::var("PATH").unwrap_or_default()
            );
            [vec!["env".to_string(), path], argv.to_vec()].concat()
        }
        async fn local_socket(
            &self,
            _: &crate::transport::SessionEntry,
        ) -> crate::error::AppResult<std::path::PathBuf> {
            unreachable!()
        }
        async fn release_socket(
            &self,
            _: &crate::transport::SessionEntry,
        ) -> crate::error::AppResult<()> {
            unreachable!()
        }
    }

    // macOS's `tail -c +1` reads ~28 MB/s, so a 50 MB transcript took 1.8 s to open: the
    // backlog is read by something else, and `tail` only follows what comes after it.
    #[tokio::test]
    async fn tail_reads_none_of_the_backlog() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        std::fs::write(&p, "a\nb\n").unwrap();
        let shim = d.path().join("tail");
        let log = d.path().join("tail.args");
        let real = ["/usr/bin/tail", "/bin/tail"]
            .into_iter()
            .find(|t| std::path::Path::new(t).exists())
            .unwrap();
        std::fs::write(
            &shim,
            format!(
                "#!/bin/sh\necho \"$@\" > '{}'\nexec {real} \"$@\"\n",
                log.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o755)).unwrap();
        let got: Arc<Mutex<Vec<ChatEvent>>> = Arc::default();
        let g = got.clone();
        let _h = spawn_tail(
            Arc::new(ShimTail(d.path().to_path_buf())),
            p.to_string_lossy().into(),
            Box::new(Lines),
            Arc::new(move |e| g.lock().unwrap().push(e)),
        );
        wait_for(|| any_event(&got)).await;
        use std::io::Write;
        std::fs::OpenOptions::new()
            .append(true)
            .open(&p)
            .unwrap()
            .write_all(b"c\n")
            .unwrap();
        wait_for(|| any_append(&got)).await;
        let args = std::fs::read_to_string(&log).unwrap();
        assert_eq!(args.trim(), format!("-c +5 -F {}", p.display()));
        let ev = got.lock().unwrap();
        assert!(
            matches!(&ev[0], ChatEvent::Reset { total: 2, .. }),
            "{ev:?}"
        );
        let user = |t: &str| ChatItem::User {
            ts: None,
            text: t.into(),
            images: vec![],
            skills: vec![],
        };
        assert!(
            ev.iter()
                .any(|e| matches!(e, ChatEvent::Append { items } if items == &vec![user("c")])),
            "{ev:?}"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_image_store_is_free_while_a_line_parses() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        std::fs::write(&p, "a\n").unwrap();
        let (entered_tx, entered) = std::sync::mpsc::channel();
        let (release, release_rx) = std::sync::mpsc::channel();
        let h = spawn_tail(
            Arc::new(crate::transport::local::LocalTransport),
            p.to_string_lossy().into(),
            Box::new(Stuck {
                entered: entered_tx,
                release: release_rx,
            }),
            Arc::new(|_| {}),
        );
        let store = h.images();
        tokio::task::spawn_blocking(move || {
            entered.recv_timeout(std::time::Duration::from_secs(3))
        })
        .await
        .unwrap()
        .expect("parser never ran");
        assert!(
            store.try_lock().is_ok(),
            "the store is locked during the parse"
        );
        release.send(()).unwrap();
        wait_for(|| store.lock().unwrap().get("r").is_some()).await;
        assert_eq!(
            store.lock().unwrap().get("r"),
            Some(("image/png".to_string(), vec![1]))
        );
    }

    #[tokio::test]
    async fn meta_sent_after_reset_and_on_change() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        std::fs::write(&p, "a\n").unwrap();
        let got: Arc<Mutex<Vec<ChatEvent>>> = Arc::default();
        let g = got.clone();
        let h = spawn_tail(
            Arc::new(crate::transport::local::LocalTransport),
            p.to_string_lossy().into(),
            Box::new(MetaLines { model: None }),
            Arc::new(move |e| g.lock().unwrap().push(e)),
        );
        wait_for(|| any_event(&got)).await;
        {
            let ev = got.lock().unwrap();
            assert_eq!(ev.len(), 1, "{ev:?}");
            assert!(matches!(ev[0], ChatEvent::Reset { .. }));
        }
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        writeln!(f, "MODEL m1\nb\nIMG r1").unwrap();
        let store = h.images();
        wait_for(|| store.lock().unwrap().get("r1").is_some()).await;
        let before = got.lock().unwrap().len();
        writeln!(f, "c").unwrap();
        wait_for(|| got.lock().unwrap().len() > before).await;
        let ev = got.lock().unwrap();
        let metas: Vec<_> = ev
            .iter()
            .filter_map(|e| match e {
                ChatEvent::Meta { model, .. } => Some(model.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(metas, vec![Some("m1".to_string())]);
        assert_eq!(
            store.lock().unwrap().get("r1"),
            Some(("image/png".to_string(), vec![7, 7]))
        );
        assert_eq!(store.lock().unwrap().get("nope"), None);
        drop(ev);
        drop(h);
    }

    #[tokio::test]
    async fn meta_known_at_open_follows_the_reset() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        std::fs::write(&p, "MODEL m0\na\n").unwrap();
        let got: Arc<Mutex<Vec<ChatEvent>>> = Arc::default();
        let g = got.clone();
        let _h = spawn_tail(
            Arc::new(crate::transport::local::LocalTransport),
            p.to_string_lossy().into(),
            Box::new(MetaLines { model: None }),
            Arc::new(move |e| g.lock().unwrap().push(e)),
        );
        wait_for(|| got.lock().unwrap().len() >= 2).await;
        let ev = got.lock().unwrap();
        assert!(matches!(ev[0], ChatEvent::Reset { .. }));
        assert!(matches!(&ev[1], ChatEvent::Meta { model: Some(m), .. } if m == "m0"));
    }

    #[tokio::test]
    async fn streams_reset_then_appends() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        std::fs::write(&p, "a\nb\n").unwrap();
        let got: Arc<Mutex<Vec<ChatEvent>>> = Arc::default();
        let g = got.clone();
        let h = spawn_tail(
            Arc::new(crate::transport::local::LocalTransport),
            p.to_string_lossy().into(),
            Box::new(Lines),
            Arc::new(move |e| g.lock().unwrap().push(e)),
        );
        wait_for(|| any_event(&got)).await;
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(b"c\nRESET\n").unwrap();
        wait_for(|| {
            let ev = got.lock().unwrap();
            ev.len() > 1
                && matches!(ev.last(), Some(ChatEvent::Reset { items, .. }) if items.len() == 1)
        })
        .await;
        let ev = got.lock().unwrap();
        assert!(matches!(&ev[0], ChatEvent::Reset { items, total: 2 } if items.len() == 2));
        assert!(ev.iter().any(|e| matches!(e, ChatEvent::Append { items } if items == &vec![ChatItem::User { ts: None, text: "c".into(), images: vec![], skills: vec![] }])));
        assert!(matches!(ev.last().unwrap(), ChatEvent::Reset { items, .. } if items.len() == 1));
        drop(ev);
        drop(h);
    }
    #[test]
    fn a_truncate_keeps_the_head_and_sends_one_reset() {
        struct Cut;
        impl Parser for Cut {
            fn push_line(&mut self, line: &str, _: &mut dyn ImageSink) -> ParserOutput {
                let user = |t: &str| ChatItem::User {
                    ts: None,
                    text: t.into(),
                    images: vec![],
                    skills: vec![],
                };
                if line == "CUT" {
                    ParserOutput::Truncate {
                        keep: 1,
                        items: vec![user("x")],
                    }
                } else {
                    ParserOutput::Append(vec![user(line)])
                }
            }
        }
        let text = |i: &ChatItem| match i {
            ChatItem::User { text, .. } => text.clone(),
            other => format!("{other:?}"),
        };
        let mut st = state(Box::new(Cut));
        st.sent_first = true;
        st.line("a");
        st.line("b");
        st.line("CUT");
        assert_eq!(
            st.items
                .lock()
                .unwrap()
                .iter()
                .map(text)
                .collect::<Vec<_>>(),
            ["a", "x"]
        );
        assert!(
            st.appended.is_empty(),
            "the Reset covers what was not sent yet"
        );
        match st.events.as_slice() {
            [ChatEvent::Reset { items, total: 2 }] => {
                assert_eq!(items.iter().map(text).collect::<Vec<_>>(), ["a", "x"])
            }
            other => panic!("{other:?}"),
        }
    }
    #[tokio::test]
    async fn invalid_utf8_lines_do_not_stop_the_stream() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        std::fs::write(&p, b"a\n\xff\xfe\xfd\nb\n").unwrap();
        let got: Arc<Mutex<Vec<ChatEvent>>> = Arc::default();
        let g = got.clone();
        let _h = spawn_tail(
            Arc::new(crate::transport::local::LocalTransport),
            p.to_string_lossy().into(),
            Box::new(Lines),
            Arc::new(move |e| g.lock().unwrap().push(e)),
        );
        wait_for(|| any_event(&got)).await;
        assert!(
            matches!(&got.lock().unwrap()[0], ChatEvent::Reset { items, total: 3 } if items[0] == ChatItem::User { ts: None, text: "a".into(), images: vec![], skills: vec![] } && items[2] == ChatItem::User { ts: None, text: "b".into(), images: vec![], skills: vec![] }),
            "{:?}",
            summary(&got)
        );
    }
    #[tokio::test]
    async fn empty_and_missing_files_still_reset() {
        let d = tempfile::tempdir().unwrap();
        for name in ["empty.jsonl", "missing.jsonl"] {
            let p = d.path().join(name);
            if name == "empty.jsonl" {
                std::fs::write(&p, "").unwrap();
            }
            let got: Arc<Mutex<Vec<ChatEvent>>> = Arc::default();
            let g = got.clone();
            let _h = spawn_tail(
                Arc::new(crate::transport::local::LocalTransport),
                p.to_string_lossy().into(),
                Box::new(Lines),
                Arc::new(move |e| g.lock().unwrap().push(e)),
            );
            wait_for(|| any_event(&got)).await;
            assert!(
                matches!(&got.lock().unwrap()[0], ChatEvent::Reset { items, total: 0 } if items.is_empty()),
                "{name}"
            );
        }
    }
    fn tail_running(path: &str) -> bool {
        std::process::Command::new("pgrep")
            .args(["-f", "--", &format!("-F {path}")])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[tokio::test]
    async fn dropping_the_handle_ends_tail() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("drop-me.jsonl");
        std::fs::write(&p, "a\n").unwrap();
        let path: String = p.to_string_lossy().into();
        let h = spawn_tail(
            Arc::new(crate::transport::local::LocalTransport),
            path.clone(),
            Box::new(Lines),
            Arc::new(|_| {}),
        );
        wait_for(|| tail_running(&path)).await;
        drop(h);
        for _ in 0..40 {
            if !tail_running(&path) {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        panic!("tail still running after drop");
    }
    #[tokio::test]
    async fn pages_older_items() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        std::fs::write(&p, (0..700).map(|i| format!("m{i}\n")).collect::<String>()).unwrap();
        let got: Arc<Mutex<Vec<ChatEvent>>> = Arc::default();
        let g = got.clone();
        let h = spawn_tail(
            Arc::new(crate::transport::local::LocalTransport),
            p.to_string_lossy().into(),
            Box::new(Lines),
            Arc::new(move |e| g.lock().unwrap().push(e)),
        );
        wait_for(|| any_event(&got)).await;
        assert!(
            matches!(&got.lock().unwrap()[0], ChatEvent::Reset { items, total: 700 } if items.len() == 500 && items[0] == ChatItem::User { ts: None, text: "m200".into(), images: vec![], skills: vec![] })
        );
        let older = h.page(200, 200);
        assert_eq!(older.len(), 200);
        assert_eq!(
            older[0],
            ChatItem::User {
                images: vec![],
                skills: vec![],
                ts: None,
                text: "m0".into()
            }
        );
    }

    /// Starts the command only after `delay`, like a slow ssh: nothing arrives at first.
    struct Slow(&'static str);
    #[async_trait::async_trait]
    impl crate::transport::Transport for Slow {
        fn wrap(&self, argv: &[String], _tty: bool) -> Vec<String> {
            let mut v: Vec<String> = vec![
                "sh".into(),
                "-c".into(),
                format!("sleep {}; exec \"$@\"", self.0),
                "sh".into(),
            ];
            v.extend(argv.iter().cloned());
            v
        }
        async fn local_socket(
            &self,
            _: &crate::transport::SessionEntry,
        ) -> crate::error::AppResult<std::path::PathBuf> {
            unreachable!()
        }
        async fn release_socket(
            &self,
            _: &crate::transport::SessionEntry,
        ) -> crate::error::AppResult<()> {
            unreachable!()
        }
    }
    /// Runs the command through a shell pipeline `filter` that sees its output on stdin.
    struct Piped(&'static str);
    #[async_trait::async_trait]
    impl crate::transport::Transport for Piped {
        fn wrap(&self, argv: &[String], _tty: bool) -> Vec<String> {
            let mut v: Vec<String> = vec![
                "sh".into(),
                "-c".into(),
                format!("\"$@\" | {{ {}; }}", self.0),
                "sh".into(),
            ];
            v.extend(argv.iter().cloned());
            v
        }
        async fn local_socket(
            &self,
            _: &crate::transport::SessionEntry,
        ) -> crate::error::AppResult<std::path::PathBuf> {
            unreachable!()
        }
        async fn release_socket(
            &self,
            _: &crate::transport::SessionEntry,
        ) -> crate::error::AppResult<()> {
            unreachable!()
        }
    }
    fn collect(
        t: Arc<dyn crate::transport::Transport>,
        p: &std::path::Path,
    ) -> (TailHandle, Arc<Mutex<Vec<ChatEvent>>>) {
        let got: Arc<Mutex<Vec<ChatEvent>>> = Arc::default();
        let g = got.clone();
        let h = spawn_tail(
            t,
            p.to_string_lossy().into(),
            Box::new(Lines),
            Arc::new(move |e| g.lock().unwrap().push(e)),
        );
        (h, got)
    }

    fn state(parser: Box<dyn Parser>) -> State {
        State {
            items: Arc::default(),
            images: Arc::new(Mutex::new(ImageStore::new(IMAGE_BUDGET))),
            last_meta: ChatMeta::default(),
            parser,
            link: Arc::new(Mutex::new(Link {
                sink: None,
                pending: None,
            })),
            events: Vec::new(),
            appended: Vec::new(),
            sent_first: false,
            size: None,
            consumed: 0,
            last_byte: None,
            path: String::new(),
            fetched: None,
            began: Instant::now(),
            parse_time: Duration::ZERO,
            _done: DoneOnDrop(Arc::default()),
        }
    }

    #[test]
    fn the_parse_thread_marks_the_tail_done_however_it_ends() {
        for eof in [true, false] {
            let st = state(Box::new(Lines));
            let done = st._done.0.clone();
            let (tx, rx) = tokio::sync::mpsc::channel(4);
            if eof {
                tx.blocking_send(Msg::Eof).unwrap();
            } else {
                drop(tx);
            }
            parse_loop(st, rx);
            assert!(done.load(Ordering::Acquire), "eof: {eof}");
        }
    }

    #[tokio::test]
    async fn a_done_tail_is_not_running_while_its_reader_lingers() {
        let done: Arc<AtomicBool> = Arc::default();
        let h = TailHandle {
            items: Arc::default(),
            images: Arc::new(Mutex::new(ImageStore::new(IMAGE_BUDGET))),
            link: Arc::new(Mutex::new(Link {
                sink: None,
                pending: None,
            })),
            task: tokio::spawn(std::future::pending()),
            done: done.clone(),
        };
        assert!(h.is_running());
        done.store(true, Ordering::Release);
        assert!(!h.is_running());
    }

    #[test]
    fn the_backlog_is_not_queued_twice_before_the_first_reset() {
        let mut st = state(Box::new(Lines));
        st.line("a");
        st.line("b");
        assert_eq!(st.items.lock().unwrap().len(), 2);
        assert!(
            st.appended.is_empty(),
            "the first Reset already carries the backlog"
        );
        st.sent_first = true;
        st.line("c");
        assert_eq!(st.appended.len(), 1);
    }

    #[test]
    fn reads_the_header() {
        assert_eq!(
            parse_header(b"   1234 1000      56 zstd"),
            Some(Header {
                size: 1234,
                from: 1000,
                len: 56,
                codec: Codec::Zstd
            })
        );
        assert_eq!(
            parse_header(b"0 0 0 raw"),
            Some(Header {
                size: 0,
                from: 0,
                len: 0,
                codec: Codec::Raw
            })
        );
        assert_eq!(parse_header(b" junk"), None);
        assert_eq!(parse_header(b"1 0 1 lz4"), None);
        assert_eq!(parse_header(b"1 2 0 raw"), None, "from past the end");
    }

    fn user_text(i: &ChatItem) -> &str {
        match i {
            ChatItem::User { text, .. } => text,
            _ => "",
        }
    }

    fn open_with(p: &std::path::Path, fetch: Fetch) -> (TailHandle, Arc<Mutex<Vec<ChatEvent>>>) {
        let got: Arc<Mutex<Vec<ChatEvent>>> = Arc::default();
        let g = got.clone();
        let h = spawn_tail_with(
            Arc::new(crate::transport::local::LocalTransport),
            p.to_string_lossy().into(),
            fetch,
            Box::new(Lines),
            Arc::new(move |e| g.lock().unwrap().push(e)),
        );
        (h, got)
    }

    fn append(p: &std::path::Path, bytes: &[u8]) {
        use std::io::Write;
        std::fs::OpenOptions::new()
            .append(true)
            .open(p)
            .unwrap()
            .write_all(bytes)
            .unwrap();
    }

    #[tokio::test]
    async fn each_codec_delivers_the_backlog_then_follows() {
        for codec in [Codec::Zstd, Codec::Gzip, Codec::Raw] {
            let d = tempfile::tempdir().unwrap();
            let p = d.path().join("t.jsonl");
            std::fs::write(&p, (0..2000).map(|i| format!("m{i}\n")).collect::<String>()).unwrap();
            let (_h, got) = open_with(&p, Fetch { cache: None, codec });
            wait_for(|| any_event(&got)).await;
            append(&p, b"x\n");
            wait_for(|| any_append(&got)).await;
            let ev = got.lock().unwrap();
            assert!(
                matches!(&ev[0], ChatEvent::Reset { total: 2000, items } if user_text(&items[0]) == "m1500"),
                "{codec:?}: {:?}",
                ev.first()
            );
            assert!(
                ev.iter().any(|e| matches!(e, ChatEvent::Append { items } if items.len() == 1 && user_text(&items[0]) == "x")),
                "{codec:?}: {ev:?}"
            );
        }
    }

    #[test]
    fn only_a_machine_over_ssh_caches_and_compresses() {
        let local = Fetch::for_machine(crate::machines::LOCAL, "/t");
        assert!(local.cache.is_none());
        assert_eq!(local.codec, Codec::Raw);
        assert_eq!(Fetch::for_machine("ct-hms", "/t").codec, Codec::Zstd);
    }

    #[test]
    fn the_script_compresses_with_the_codec_asked_for() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        let body = "line\n".repeat(1000);
        std::fs::write(&p, &body).unwrap();
        for (ask, c, k, want) in [
            ("zstd", "0".to_string(), "0".to_string(), "zstd"),
            ("gzip", "0".into(), "0".into(), "gzip"),
            ("raw", "0".into(), "0".into(), "raw"),
            // All of it cached: nothing to send, so nothing to compress.
            (
                "zstd",
                body.len().to_string(),
                cache::window_cksum(body.as_bytes()),
                "raw",
            ),
        ] {
            let mut child = std::process::Command::new("sh")
                .args(["-c", SCRIPT, "sh", p.to_str().unwrap(), &c, &k, ask])
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            let mut out = child.stdout.take().unwrap();
            let mut first = Vec::new();
            let mut b = [0u8; 1];
            while std::io::Read::read(&mut out, &mut b).unwrap() == 1 && b[0] != b'\n' {
                first.push(b[0]);
            }
            drop(child.stdin.take());
            let h = parse_header(&first).unwrap();
            assert_eq!(h.codec.name(), want, "{ask} {c}");
            let mut wire = vec![0u8; h.len as usize];
            std::io::Read::read_exact(&mut out, &mut wire).unwrap();
            let got = h.codec.decode(&wire).unwrap();
            assert_eq!(got.len() as u64, h.size - h.from);
            if want != "raw" {
                assert!(wire.len() < body.len() / 10, "{ask}: {} bytes", wire.len());
            }
            let _ = child.wait();
        }
    }

    /// `a` then enough lines that the first is outside the checked window.
    fn long_file() -> Vec<u8> {
        let mut v = b"a\n".to_vec();
        for i in 0..1000 {
            v.extend_from_slice(format!("z{i:05}\n").as_bytes());
        }
        v
    }

    #[tokio::test]
    async fn a_reopen_reads_the_backlog_from_the_cache() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        let first = long_file();
        std::fs::write(&p, &first).unwrap();
        let slot = cache::Slot::in_dir(&d.path().join("cache"), "m", "/t");
        let fetch = || Fetch {
            cache: Some(slot.clone()),
            codec: Codec::Zstd,
        };
        let (h, got) = open_with(&p, fetch());
        wait_for(|| any_event(&got)).await;
        assert!(
            matches!(
                &got.lock().unwrap()[0],
                ChatEvent::Reset { total: 1001, .. }
            ),
            "{:?}",
            summary(&got)
        );
        drop(h);
        // The cache is written off the reader, after the Reset may have gone out.
        wait_for(|| slot.load() == first).await;
        // Mark the cached copy where the Machine does not check it, so items from it show.
        let mut marked = first.clone();
        marked[0] = b'Q';
        slot.store(&marked).unwrap();
        append(&p, b"c\n");
        let (h, got) = open_with(&p, fetch());
        wait_for(|| any_event(&got)).await;
        assert!(matches!(
            &got.lock().unwrap()[0],
            ChatEvent::Reset { total: 1002, .. }
        ));
        assert_eq!(
            user_text(&h.page(1, 1)[0]),
            "Q",
            "the backlog did not come from the cache"
        );
        assert_eq!(user_text(&h.page(1002, 1)[0]), "c");
        let cached = [&marked[..], b"c\n"].concat();
        wait_for(|| slot.load() == cached).await;
    }

    #[tokio::test]
    async fn a_cache_that_no_longer_matches_is_replaced() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        std::fs::write(&p, "a\nb\n").unwrap();
        // Longer than the file, then as long but different: both mean the file was rewritten.
        for stale in [&b"x\ny\nz\n"[..], b"a\nc\n"] {
            let slot = cache::Slot::in_dir(&d.path().join("cache"), "m", "/t");
            slot.store(stale).unwrap();
            let (h, got) = open_with(
                &p,
                Fetch {
                    cache: Some(slot.clone()),
                    codec: Codec::Gzip,
                },
            );
            wait_for(|| any_event(&got)).await;
            assert!(matches!(
                &got.lock().unwrap()[0],
                ChatEvent::Reset { total: 2, .. }
            ));
            assert_eq!(user_text(&h.page(2, 1)[0]), "b");
            wait_for(|| slot.load() == b"a\nb\n").await;
        }
    }

    #[tokio::test]
    async fn a_slow_start_still_sends_the_whole_backlog_as_one_reset() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        std::fs::write(&p, (0..50).map(|i| format!("m{i}\n")).collect::<String>()).unwrap();
        // Slower than QUIET (1 s in tests): the quiet clock must not run before the first byte.
        let (_h, got) = collect(Arc::new(Slow("1.3")), &p);
        wait_for(|| any_event(&got)).await;
        let ev = got.lock().unwrap();
        assert!(
            matches!(&ev[0], ChatEvent::Reset { total: 50, .. }),
            "{ev:?}"
        );
        assert!(
            !ev.iter().any(|e| matches!(e, ChatEvent::Append { .. })),
            "{ev:?}"
        );
    }

    #[tokio::test]
    async fn a_last_line_without_newline_follows_the_reset() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        std::fs::write(&p, "a\nb").unwrap();
        let (_h, got) = collect(Arc::new(crate::transport::local::LocalTransport), &p);
        wait_for(|| any_event(&got)).await;
        assert!(
            matches!(&got.lock().unwrap()[0], ChatEvent::Reset { total: 1, .. }),
            "{:?}",
            summary(&got)
        );
        use std::io::Write;
        std::fs::OpenOptions::new()
            .append(true)
            .open(&p)
            .unwrap()
            .write_all(b"\n")
            .unwrap();
        wait_for(|| any_append(&got)).await;
        let ev = got.lock().unwrap();
        assert!(
            ev.iter()
                .any(|e| matches!(e, ChatEvent::Append { items } if items.len() == 1)),
            "{ev:?}"
        );
    }

    #[tokio::test]
    async fn a_pause_after_the_header_still_sends_the_whole_backlog_as_one_reset() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        std::fs::write(&p, "a\nb\nc\n").unwrap();
        // Longer than QUIET (1 s in tests) between the header and the backlog, as a busy Machine
        // or a slow decode makes it: the size is known, so silence must not end the backlog.
        let pause = Piped("IFS= read -r h; printf '%s\\n' \"$h\"; sleep 1.5; exec cat");
        let (_h, got) = collect(Arc::new(pause), &p);
        wait_for(|| any_event(&got)).await;
        assert!(
            matches!(&got.lock().unwrap()[0], ChatEvent::Reset { total: 3, .. }),
            "{:?}",
            summary(&got)
        );
    }

    #[test]
    fn silence_ends_the_first_backlog_only_when_its_size_is_unknown() {
        for (size, ends) in [(Some(100), false), (None, true)] {
            let mut st = state(Box::new(Lines));
            st.size = size;
            st.consumed = 10;
            st.last_byte = Some(Instant::now() - QUIET * 2);
            st.flush();
            assert_eq!(st.sent_first, ends, "size {size:?}");
        }
    }

    #[tokio::test]
    async fn an_unreadable_header_falls_back_to_quiet() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("t.jsonl");
        std::fs::write(&p, "a\n").unwrap();
        // A junk first line, so the size header is unreadable. Printed once the script's own
        // output arrives: a slow start must not count as silence.
        let junk = Piped("IFS= read -r h; echo ' junk'; printf '%s\\n' \"$h\"; exec cat");
        let (_h, got) = collect(Arc::new(junk), &p);
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        assert!(got.lock().unwrap().is_empty(), "sent before QUIET");
        wait_for(|| any_event(&got)).await;
        // The real size line becomes an item: only the quiet rule could have sent this Reset.
        assert!(
            matches!(&got.lock().unwrap()[0], ChatEvent::Reset { total: 2, .. }),
            "{:?}",
            summary(&got)
        );
    }
}
