//! Claude Code transcript parser.
use super::images::{decode_image, ImageSink};
use super::locate::input_summary;
use super::{
    cap_input, meta_label, truncate_result as truncate, BackgroundKind, BackgroundTask, ChatItem,
    ChatMeta, ImageRef, Parser, ParserOutput, TaskEnd,
};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};

#[derive(Default)]
pub struct ClaudeParser {
    meta: ChatMeta,
    /// The CLI's prompt queue as its `queue-operation` records leave it: what was sent
    /// mid-turn and not read yet. `None` is an entry recorded without its text.
    queue: VecDeque<Option<String>>,
    /// Bash and Agent calls whose result has not arrived: call id → kind, description, start time.
    calls: HashMap<String, (BackgroundKind, String, Option<String>)>,
    /// Background tasks started and not yet reported finished, oldest first.
    background: Vec<BackgroundTask>,
    /// Tasks whose end was already shown, oldest first and bounded: a repeat is dropped.
    ended: VecDeque<String>,
    /// Running background tasks' own ids (from their start result): call id → task id.
    task_ids: HashMap<String, String>,
    /// `TaskStop` / `KillShell` calls whose result has not arrived: call id → target task id.
    stops: HashMap<String, String>,
    /// A slash command shown as typed, with no user item shown after it yet: `/compact`
    /// is written as typed and again in command form when it runs (after the boundary,
    /// after a cancel, or after the turn it was typed into), and that copy is not shown.
    typed: Option<String>,
    /// The line being parsed showed `typed`.
    typed_now: bool,
    /// Items shown so far: where the next line's items start.
    shown: usize,
    /// Where each of the user's messages starts, by its parent entry. A later message under the
    /// same parent is the same one edited and sent again (Claude's rewind): the branch from the
    /// earlier one on is left behind.
    prompts: HashMap<String, usize>,
    /// The `parentUuid` of the user line being parsed.
    line_parent: Option<String>,
}

/// Most unfinished calls and ended task ids kept; the oldest are forgotten past it.
const TRACKED_MAX: usize = 512;

/// What a result starts with when its call went to the background.
fn started_prefix(kind: &BackgroundKind) -> &'static str {
    match kind {
        BackgroundKind::Bash => "Command running in background with ID:",
        BackgroundKind::Agent => "Async agent launched",
    }
}

/// The task id a start result names: Bash `ID: <id>.`, Agent `agentId: <id>`.
fn task_id_of(kind: &BackgroundKind, output: &str) -> Option<String> {
    let marker = match kind {
        BackgroundKind::Bash => "ID:",
        BackgroundKind::Agent => "agentId:",
    };
    let rest = output[output.find(marker)? + marker.len()..].trim_start();
    let id: String = rest
        .chars()
        .take_while(|c| !c.is_whitespace() && *c != '.')
        .collect();
    (!id.is_empty()).then_some(id)
}

/// The `N` of `(exit code N)` in a task's summary.
fn exit_code(summary: &str) -> Option<i32> {
    let rest = &summary[summary.rfind("(exit code ")? + "(exit code ".len()..];
    rest[..rest.find(')')?].trim().parse().ok()
}

fn flag(v: &Value, key: &str) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn result_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Every `<name>` element's text, in order.
fn tags<'a>(mut text: &'a str, name: &str) -> Vec<&'a str> {
    let mut found = vec![];
    while let Some(value) = tag(text, name) {
        found.push(value);
        let close = format!("</{name}>");
        let Some(at) = text.find(&close) else { break };
        text = &text[at + close.len()..];
    }
    found
}

fn tag<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let start = text.find(&open)? + open.len();
    let len = text[start..].find(&format!("</{name}>"))?;
    Some(text[start..start + len].trim())
}

/// The chat text for a user record: a slash command reads as the user typed
/// it, and the CLI's own bookkeeping (command output, caveats) is dropped.
fn user_text(text: &str) -> Option<String> {
    if text.starts_with("<command-") {
        let name = tag(text, "command-name")?;
        return Some(match tag(text, "command-args").filter(|a| !a.is_empty()) {
            Some(args) => format!("{name} {args}"),
            None => name.to_string(),
        });
    }
    if text.starts_with("<local-command-") || text.starts_with("Caveat:") {
        return None;
    }
    Some(text.to_string())
}

/// The chat item for a user record's text: a `!` shell command and its
/// output get their own items, anything else reads as the user's words.
fn user_item(text: &str, ts: &Option<String>) -> Option<ChatItem> {
    if text.starts_with("<bash-input>") {
        let command = tag(text, "bash-input")?;
        return Some(ChatItem::ShellCommand {
            ts: ts.clone(),
            command: command.to_string(),
        });
    }
    if text.starts_with("<bash-stdout>") || text.starts_with("<bash-stderr>") {
        let stdout = tag(text, "bash-stdout").unwrap_or("");
        let stderr = tag(text, "bash-stderr").unwrap_or("");
        if stdout.is_empty() && stderr.is_empty() {
            return None;
        }
        return Some(ChatItem::ShellOutput {
            ts: ts.clone(),
            stdout: truncate(stdout.to_string()),
            stderr: truncate(stderr.to_string()),
        });
    }
    user_text(text).map(|text| ChatItem::User {
        images: vec![],
        skills: vec![],
        ts: ts.clone(),
        text,
    })
}

/// A model id from its display name, as `/model` reports it: `Sonnet 5.5` → `claude-sonnet-5-5`.
/// Parenthesised notes such as `(1M context)` are dropped.
/// A message typed while the agent is mid-turn is recorded as a
/// `queued_command` attachment, not a user record: rewrite it as the user
/// record it stands for. A task notification becomes the system record the idle
/// case writes. Other queued prompts (a subagent's hand-back) are not the user's words.
fn queued_prompt(v: &Value) -> Option<Value> {
    let a = v.get("attachment")?;
    let kind = a
        .get("origin")
        .and_then(|o| o.get("kind"))
        .and_then(Value::as_str);
    // Older CLIs mark it by `commandMode` alone, with no `origin`.
    if a.get("type").and_then(Value::as_str) == Some("queued_command")
        && (kind == Some("task-notification")
            || a.get("commandMode").and_then(Value::as_str) == Some("task-notification"))
    {
        return Some(serde_json::json!({
            "type": "user",
            "promptSource": "system",
            "timestamp": v.get("timestamp"),
            "isSidechain": v.get("isSidechain"),
            "message": {"content": a.get("prompt")},
        }));
    }
    let human = a.get("type")?.as_str()? == "queued_command"
        && a.get("commandMode").and_then(Value::as_str) == Some("prompt")
        && a.get("origin")
            .and_then(|o| o.get("kind"))
            .and_then(Value::as_str)
            == Some("human");
    human.then(|| {
        serde_json::json!({
            "type": "user",
            "uuid": v.get("uuid"),
            "timestamp": v.get("timestamp"),
            "isSidechain": v.get("isSidechain"),
            "message": {"content": a.get("prompt")},
        })
    })
}

fn model_id(display: &str) -> Option<String> {
    let name = display.split(" (").next()?.trim();
    if name.is_empty() {
        return None;
    }
    let slug = name.to_lowercase().replace([' ', '.'], "-");
    meta_label(&format!("claude-{slug}"))
}

impl ClaudeParser {
    /// `/model` and `/effort` take effect before the next reply, so read them from the
    /// command's output instead of waiting for the next assistant record.
    fn read_command_output(&mut self, text: &str) {
        let Some(out) = tag(text, "local-command-stdout") else {
            return;
        };
        if let Some(rest) = out.strip_prefix("Set model to `") {
            if let Some(model) = rest.split('`').next().and_then(model_id) {
                self.meta.model = Some(model);
            }
        } else if let Some(rest) = out.strip_prefix("Set effort level to ") {
            if let Some(effort) = rest.split_whitespace().next().and_then(meta_label) {
                self.meta.effort = Some(effort);
            }
        }
    }
}

impl ClaudeParser {
    /// A notification ends the calls it names: its `<tool-use-id>`, and the call of
    /// each `<task-id>`, which is all an older CLI writes and which the resume
    /// notice repeats once per orphaned task. The first end carries the summary.
    fn task_notification(&mut self, text: &str, ts: &Option<String>) -> ParserOutput {
        let summary = tag(text, "summary");
        let mut calls: Vec<String> = tag(text, "tool-use-id")
            .filter(|id| !id.is_empty())
            .map(str::to_string)
            .into_iter()
            .collect();
        for task in tags(text, "task-id") {
            let call = self
                .task_ids
                .iter()
                .find(|(_, id)| id.as_str() == task)
                .map(|(call, _)| call.clone());
            if let Some(call) = call.filter(|c| !calls.contains(c)) {
                calls.push(call);
            }
        }
        if calls.is_empty() {
            return match summary {
                Some(text) => ParserOutput::Append(vec![ChatItem::System {
                    ts: ts.clone(),
                    text: text.to_string(),
                    task: None,
                }]),
                None => ParserOutput::None,
            };
        }
        let mut items = vec![];
        for call_id in calls {
            if self.ended.contains(&call_id) {
                continue;
            }
            if self.ended.len() >= TRACKED_MAX {
                self.ended.pop_front();
            }
            self.ended.push_back(call_id.clone());
            self.background.retain(|t| t.call_id != call_id);
            self.task_ids.remove(&call_id);
            let shown = if items.is_empty() { summary } else { None };
            items.push(ChatItem::System {
                ts: ts.clone(),
                text: shown.unwrap_or("").to_string(),
                task: Some(TaskEnd {
                    call_id,
                    status: tag(text, "status").unwrap_or("").to_string(),
                    exit_code: shown.and_then(exit_code),
                }),
            });
        }
        if items.is_empty() {
            return ParserOutput::None;
        }
        ParserOutput::Append(items)
    }

    /// A stopped task ends at once with no notification: drop it and return its
    /// empty-text end item, which the frontend reads only for the `stopped` badge.
    fn stop_task(&mut self, target: &str, ts: &Option<String>) -> Option<ChatItem> {
        let call_id = self
            .task_ids
            .iter()
            .find(|(_, id)| id.as_str() == target)
            .map(|(call, _)| call.clone())?;
        self.task_ids.remove(&call_id);
        if !self.background.iter().any(|t| t.call_id == call_id) {
            return None;
        }
        self.background.retain(|t| t.call_id != call_id);
        if self.ended.len() >= TRACKED_MAX {
            self.ended.pop_front();
        }
        self.ended.push_back(call_id.clone());
        Some(ChatItem::System {
            ts: ts.clone(),
            text: String::new(),
            task: Some(TaskEnd {
                call_id,
                status: "stopped".into(),
                exit_code: None,
            }),
        })
    }

    /// Replays one `queue-operation` record: `enqueue` adds, `dequeue` takes the oldest
    /// (it names no text), `remove` takes the named one, `popAll` empties the queue.
    fn replay_queue(&mut self, v: &Value) {
        let content = v.get("content").and_then(Value::as_str);
        match v.get("operation").and_then(Value::as_str) {
            Some("enqueue") => self.queue.push_back(content.map(str::to_string)),
            Some("dequeue") => {
                self.queue.pop_front();
            }
            Some("remove") => {
                if let Some(text) = content {
                    self.leave_queue(text);
                }
            }
            Some("popAll") => self.queue.clear(),
            _ => {}
        }
    }

    fn leave_queue(&mut self, text: &str) {
        if let Some(i) = self.queue.iter().position(|q| q.as_deref() == Some(text)) {
            self.queue.remove(i);
        }
    }

    fn parse_line(&mut self, line: &str, images: &mut dyn ImageSink) -> ParserOutput {
        let v: Value = match serde_json::from_str::<Value>(line) {
            Ok(v) if v.get("type").and_then(Value::as_str) == Some("queue-operation") => {
                self.replay_queue(&v);
                return ParserOutput::None;
            }
            Ok(v) => queued_prompt(&v).unwrap_or(v),
            Err(e) => {
                tracing::debug!("skipping non-JSON transcript line: {e}");
                return ParserOutput::None;
            }
        };
        let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
        if kind == "user" {
            self.line_parent = v
                .get("parentUuid")
                .and_then(Value::as_str)
                .map(str::to_string);
        }
        // /compact writes no assistant turn; the boundary carries what the context holds now.
        if let Some(n) = v
            .get("compactMetadata")
            .and_then(|m| m.get("postTokens"))
            .and_then(Value::as_u64)
        {
            self.meta.context_tokens = Some(n);
        }
        if !matches!(kind, "user" | "assistant") {
            tracing::trace!(
                record_type = kind,
                "skipping transcript record: unknown type"
            );
            return ParserOutput::None;
        }
        if let Some(reason) = ["isMeta", "isSidechain", "isCompactSummary"]
            .into_iter()
            .find(|k| flag(&v, k))
        {
            // A scheduled prompt is read as a hidden record: unshown, it still leaves the queue.
            if kind == "user" && reason == "isMeta" {
                if let Some(text) = v.pointer("/message/content").and_then(Value::as_str) {
                    self.leave_queue(text);
                }
            }
            tracing::trace!(record_type = kind, reason, "skipping transcript record");
            return ParserOutput::None;
        }
        if kind == "assistant" {
            let model = v
                .get("message")
                .and_then(|m| m.get("model"))
                .and_then(Value::as_str)
                .and_then(meta_label);
            if model.is_some() {
                self.meta.model = model;
            }
            let effort = v.get("effort").and_then(Value::as_str).and_then(meta_label);
            if effort.is_some() {
                self.meta.effort = effort;
            }
            if let Some(n) = context_tokens(v.get("message").and_then(|m| m.get("usage"))) {
                self.meta.context_tokens = Some(n);
            }
        }
        let ts = v
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_string);
        let content = v.get("message").and_then(|m| m.get("content"));
        // The CLI's own prompts to the agent (a background task finishing)
        // are not the user's words: show their summary as a system line. A
        // notification is known by its text: `promptSource` is `sdk` under the SDK.
        let text = content.and_then(Value::as_str).unwrap_or("");
        if v.get("promptSource").and_then(Value::as_str) == Some("system")
            || text.starts_with("<task-notification>")
        {
            return self.task_notification(text, &ts);
        }
        let mut items = vec![];
        match content {
            Some(Value::String(s)) if kind == "user" => {
                self.read_command_output(s);
                let item = user_item(s, &ts);
                if let Some(ChatItem::User { text, .. }) = &item {
                    if s.starts_with("<command-") && self.typed.as_ref() == Some(text) {
                        self.typed = None;
                        return ParserOutput::None;
                    }
                    if text.starts_with('/') && !s.starts_with('<') {
                        self.typed = Some(text.clone());
                        self.typed_now = true;
                    }
                }
                items.extend(item);
            }
            Some(Value::Array(blocks)) => {
                let uuid = v.get("uuid").and_then(Value::as_str);
                let mut refs = vec![];
                for (index, b) in blocks.iter().enumerate() {
                    let bt = b.get("type").and_then(Value::as_str).unwrap_or("");
                    match (kind, bt) {
                        ("user", "text") => items.extend(
                            b.get("text")
                                .and_then(Value::as_str)
                                .and_then(|t| user_item(t, &ts)),
                        ),
                        ("user", "tool_result") => {
                            let call_id = b
                                .get("tool_use_id")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string();
                            let output = result_text(b.get("content"));
                            let is_error = flag(b, "is_error");
                            if let Some(target) = self.stops.remove(&call_id) {
                                if !is_error {
                                    items.extend(self.stop_task(&target, &ts));
                                }
                            }
                            if let Some((kind, description, started)) = self.calls.remove(&call_id)
                            {
                                if !is_error && output.starts_with(started_prefix(&kind)) {
                                    if let Some(id) = task_id_of(&kind, &output) {
                                        if self.task_ids.len() >= TRACKED_MAX {
                                            self.task_ids.clear();
                                        }
                                        self.task_ids.insert(call_id.clone(), id);
                                    }
                                    self.background.push(BackgroundTask {
                                        call_id: call_id.clone(),
                                        kind,
                                        description,
                                        started,
                                    });
                                }
                            }
                            items.push(ChatItem::ToolResult {
                                images: vec![],
                                ts: ts.clone(),
                                call_id,
                                output: truncate(output),
                                is_error,
                            });
                        }
                        ("assistant", "text") => {
                            if let Some(t) = b.get("text").and_then(Value::as_str) {
                                items.push(ChatItem::AssistantText {
                                    ts: ts.clone(),
                                    markdown: t.to_string(),
                                });
                            }
                        }
                        ("assistant", "thinking") => {
                            if let Some(t) = b.get("thinking").and_then(Value::as_str) {
                                items.push(ChatItem::Thinking {
                                    ts: ts.clone(),
                                    text: t.to_string(),
                                });
                            }
                        }
                        ("assistant", "tool_use") => {
                            let name = b
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string();
                            let input = b.get("input").cloned().unwrap_or(Value::Null);
                            let id = b
                                .get("id")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string();
                            let field = |k: &str| input.get(k).and_then(Value::as_str);
                            let task = match name.as_str() {
                                "Bash" => Some((
                                    BackgroundKind::Bash,
                                    field("description").map(str::to_string).unwrap_or_else(|| {
                                        field("command").unwrap_or("").chars().take(80).collect()
                                    }),
                                )),
                                "Agent" => Some((
                                    BackgroundKind::Agent,
                                    field("description").unwrap_or("").to_string(),
                                )),
                                _ => None,
                            };
                            let target = match name.as_str() {
                                "TaskStop" => field("task_id"),
                                "KillShell" => field("shell_id"),
                                _ => None,
                            };
                            if let Some(target) = target {
                                if self.stops.len() >= TRACKED_MAX {
                                    self.stops.clear();
                                }
                                self.stops.insert(id.clone(), target.to_string());
                            }
                            if let Some((kind, description)) = task {
                                if self.calls.len() >= TRACKED_MAX {
                                    self.calls.clear();
                                }
                                self.calls
                                    .insert(id.clone(), (kind, description, ts.clone()));
                            }
                            items.push(ChatItem::ToolCall {
                                ts: ts.clone(),
                                id,
                                input_summary: input_summary(&name, &input),
                                name,
                                input: cap_input(input),
                            });
                        }
                        ("user", "image") => {
                            let source = b.get("source");
                            let field =
                                |k: &str| source.and_then(|s| s.get(k)).and_then(Value::as_str);
                            if let (Some(uuid), Some("base64"), Some(media_type), Some(data)) =
                                (uuid, field("type"), field("media_type"), field("data"))
                            {
                                if let Some(bytes) = decode_image(media_type, data) {
                                    let reference = format!("{uuid}:{index}");
                                    images.put(reference.clone(), media_type.to_string(), bytes);
                                    refs.push(ImageRef {
                                        reference,
                                        media_type: media_type.to_string(),
                                    });
                                }
                            }
                        }
                        _ => {}
                    }
                }
                if !refs.is_empty() {
                    match items
                        .iter_mut()
                        .find(|i| matches!(i, ChatItem::User { .. }))
                    {
                        Some(ChatItem::User { images, .. }) => *images = refs,
                        _ => items.insert(
                            0,
                            ChatItem::User {
                                ts: ts.clone(),
                                text: String::new(),
                                images: refs,
                                skills: vec![],
                            },
                        ),
                    }
                }
            }
            _ => {}
        }
        if items.is_empty() {
            ParserOutput::None
        } else {
            ParserOutput::Append(items)
        }
    }
}

impl ClaudeParser {
    /// `out` as the active branch shows it: a message of the user's sent again under the parent
    /// of an earlier one drops that earlier one and everything after it.
    fn follow_branch(&mut self, out: ParserOutput) -> ParserOutput {
        let parent = self.line_parent.take();
        let ParserOutput::Append(items) = out else {
            return out;
        };
        let start = self.shown;
        let words = items.iter().any(|i| matches!(i, ChatItem::User { .. }));
        if let (true, Some(parent)) = (words, parent) {
            if let Some(&old) = self.prompts.get(&parent) {
                self.prompts.retain(|_, at| *at < old);
                self.prompts.insert(parent, old);
                self.shown = old + items.len();
                return ParserOutput::Truncate { keep: old, items };
            }
            self.prompts.insert(parent, start);
        }
        self.shown += items.len();
        ParserOutput::Append(items)
    }
}

impl Parser for ClaudeParser {
    fn push_line(&mut self, line: &str, images: &mut dyn ImageSink) -> ParserOutput {
        let out = self.parse_line(line, images);
        let out = self.follow_branch(out);
        let typed_now = std::mem::take(&mut self.typed_now);
        if matches!(&out, ParserOutput::Append(items) | ParserOutput::Truncate { items, .. } if items.iter().any(|i| matches!(i, ChatItem::User { .. })))
            && !typed_now
        {
            self.typed = None;
        }
        // A queued message shown as the user's words has been read, whatever the queue
        // records said: it must not also wait in the queue.
        if let ParserOutput::Append(items) | ParserOutput::Truncate { items, .. } = &out {
            for item in items {
                if let ChatItem::User { text, .. } = item {
                    self.leave_queue(text);
                }
            }
        }
        out
    }

    fn meta(&self) -> ChatMeta {
        ChatMeta {
            // The CLI's own entries (a task finishing, a subagent's hand-back, another
            // session's message) are tagged `<…>`; they are not the user's words. A long
            // paste is the user's, wrapped `<pasted_content id="…">` by the CLI.
            queued: self
                .queue
                .iter()
                .flatten()
                .filter(|text| !text.starts_with('<') || text.starts_with("<pasted_content"))
                .cloned()
                .collect(),
            background: self.background.clone(),
            ..self.meta.clone()
        }
    }
}

/// A reply's whole context: the prompt (fresh, cached and newly cached) plus its output.
/// None when the usage is missing or all zero, as on a synthetic reply.
fn context_tokens(usage: Option<&Value>) -> Option<u64> {
    let usage = usage?;
    let n: u64 = [
        "input_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
        "output_tokens",
    ]
    .iter()
    .filter_map(|k| usage.get(*k).and_then(Value::as_u64))
    .sum();
    (n > 0).then_some(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::{ChatItem::*, Parser, ParserOutput};
    #[test]
    fn caps_a_huge_write_but_summarises_the_whole_input() {
        let content = "x".repeat(1024 * 1024);
        let line = serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"t","name":"Write","input":{"file_path":"/src/a.rs","content":content}}]}}).to_string();
        let full = input_summary(
            "Write",
            &serde_json::json!({"file_path":"/src/a.rs","content":content}),
        );
        match ClaudeParser::default().push_line(&line, &mut Vec::<(String, String, Vec<u8>)>::new())
        {
            ParserOutput::Append(v) => match &v[0] {
                ChatItem::ToolCall {
                    input,
                    input_summary,
                    ..
                } => {
                    assert!(input["content"].as_str().unwrap().len() < 70 * 1024);
                    assert_eq!(input_summary, &full);
                }
                other => panic!("{other:?}"),
            },
            other => panic!("{other:?}"),
        }
    }
    /// What the Chat lens shows after `lines`, applying every kind of output as the tail does.
    fn shown(lines: &[&str]) -> Vec<String> {
        let mut p = ClaudeParser::default();
        let mut items: Vec<ChatItem> = vec![];
        for l in lines {
            match p.push_line(l, &mut Vec::<(String, String, Vec<u8>)>::new()) {
                ParserOutput::Append(v) => items.extend(v),
                ParserOutput::Reset(v) => items = v,
                ParserOutput::Truncate { keep, items: v } => {
                    items.truncate(keep);
                    items.extend(v);
                }
                ParserOutput::None => {}
            }
        }
        items
            .iter()
            .map(|i| match i {
                ChatItem::User { text, .. } => format!("U {text}"),
                ChatItem::AssistantText { markdown, .. } => format!("A {markdown}"),
                ChatItem::ToolCall { id, .. } => format!("T {id}"),
                ChatItem::ToolResult { call_id, .. } => format!("R {call_id}"),
                other => format!("{other:?}"),
            })
            .collect()
    }
    const U1: &str =
        r#"{"type":"user","uuid":"u1","parentUuid":null,"message":{"content":"Remember APPLE"}}"#;
    const A1: &str = r#"{"type":"assistant","uuid":"a1","parentUuid":"u1","message":{"content":[{"type":"text","text":"OK1"}]}}"#;
    const U2: &str =
        r#"{"type":"user","uuid":"u2","parentUuid":"a1","message":{"content":"Remember BANANA"}}"#;
    const A2: &str = r#"{"type":"assistant","uuid":"a2","parentUuid":"u2","message":{"content":[{"type":"text","text":"OK2"}]}}"#;
    #[test]
    fn a_message_edited_and_sent_again_drops_the_abandoned_branch() {
        // Claude's rewind (Esc Esc) writes the new message beside the old one, under the same parent.
        let u3 = r#"{"type":"user","uuid":"u3","parentUuid":"a1","message":{"content":"Remember CHERRY instead"}}"#;
        let a3 = r#"{"type":"assistant","uuid":"a3","parentUuid":"u3","message":{"content":[{"type":"text","text":"OK3"}]}}"#;
        assert_eq!(
            shown(&[U1, A1, U2, A2, u3, a3]),
            [
                "U Remember APPLE",
                "A OK1",
                "U Remember CHERRY instead",
                "A OK3"
            ]
        );
    }
    #[test]
    fn a_second_rewind_to_the_same_point_drops_the_branch_before_it() {
        let u3 = r#"{"type":"user","uuid":"u3","parentUuid":"a1","message":{"content":"CHERRY"}}"#;
        let a3 = r#"{"type":"assistant","uuid":"a3","parentUuid":"u3","message":{"content":[{"type":"text","text":"OK3"}]}}"#;
        let u4 = r#"{"type":"user","uuid":"u4","parentUuid":"a1","message":{"content":"DATE"}}"#;
        assert_eq!(
            shown(&[U1, A1, U2, A2, u3, a3, u4]),
            ["U Remember APPLE", "A OK1", "U DATE"]
        );
    }
    #[test]
    fn rewinding_to_the_first_message_starts_over() {
        let u0 =
            r#"{"type":"user","uuid":"u0","parentUuid":null,"message":{"content":"start again"}}"#;
        // A first message has no parent to share: nothing is dropped.
        assert_eq!(
            shown(&[U1, A1, u0]),
            ["U Remember APPLE", "A OK1", "U start again"]
        );
    }
    #[test]
    fn parallel_tool_results_under_one_parent_are_not_a_rewind() {
        let a = r#"{"type":"assistant","uuid":"a","parentUuid":"u1","message":{"content":[{"type":"tool_use","id":"T1","name":"Bash","input":{"command":"ls"}}]}}"#;
        let b = r#"{"type":"assistant","uuid":"b","parentUuid":"a","message":{"content":[{"type":"tool_use","id":"T2","name":"Bash","input":{"command":"pwd"}}]}}"#;
        let r1 = r#"{"type":"user","uuid":"r1","parentUuid":"a","message":{"content":[{"type":"tool_result","tool_use_id":"T1","content":"x"}]}}"#;
        let r2 = r#"{"type":"user","uuid":"r2","parentUuid":"b","message":{"content":[{"type":"tool_result","tool_use_id":"T2","content":"y"}]}}"#;
        let r1b = r#"{"type":"user","uuid":"r1b","parentUuid":"a","message":{"content":[{"type":"tool_result","tool_use_id":"T9","content":"z"}]}}"#;
        assert_eq!(
            shown(&[U1, a, b, r1, r2, r1b]),
            ["U Remember APPLE", "T T1", "T T2", "R T1", "R T2", "R T9"]
        );
    }
    fn run(text: &str) -> Vec<ChatItem> {
        let mut p = ClaudeParser::default();
        let mut out = vec![];
        for l in text.lines() {
            if let ParserOutput::Append(v) =
                p.push_line(l, &mut Vec::<(String, String, Vec<u8>)>::new())
            {
                out.extend(v)
            }
        }
        out
    }
    #[test]
    fn parses_fixture() {
        let items = run(include_str!("../../tests/fixtures/claude.jsonl"));
        assert_eq!(
            items,
            vec![
                User {
                    images: vec![],
                    skills: vec![],
                    ts: None,
                    text: "list files".into()
                },
                Thinking {
                    ts: None,
                    text: "need ls".into()
                },
                AssistantText {
                    ts: None,
                    markdown: "Listing **now**.".into()
                },
                ToolCall {
                    ts: None,
                    id: "toolu_1".into(),
                    name: "Bash".into(),
                    input_summary: "ls".into(),
                    input: serde_json::json!({"command":"ls","description":"list"})
                },
                ToolResult {
                    images: vec![],
                    ts: None,
                    call_id: "toolu_1".into(),
                    output: "a.txt\nb.txt".into(),
                    is_error: false
                },
                ToolResult {
                    images: vec![],
                    ts: None,
                    call_id: "toolu_2".into(),
                    output: "boom".into(),
                    is_error: true
                },
                User {
                    images: vec![],
                    skills: vec![],
                    ts: None,
                    text: "/clear".into()
                },
                AssistantText {
                    ts: None,
                    markdown: "Done.".into()
                },
            ]
        );
    }
    #[test]
    fn skips_garbage_lines() {
        let items = run("{\"type\":\"user\",\"message\":{\"content\":\"a\"}}\n\u{FFFD}\u{FFFD}garbage\n{\"type\":\"user\",\"message\":{\"content\":\"b\"}");
        assert_eq!(
            items,
            vec![User {
                images: vec![],
                skills: vec![],
                ts: None,
                text: "a".into()
            }]
        );
        let more = run("{\"type\":\"user\",\"message\":{\"content\":\"b\"}}");
        assert_eq!(
            more,
            vec![User {
                images: vec![],
                skills: vec![],
                ts: None,
                text: "b".into()
            }]
        );
    }
    #[test]
    fn shows_slash_commands_as_user_text() {
        let line = serde_json::json!({"type":"user","message":{"content":"<command-message>working-time</command-message>\n<command-name>/working-time</command-name>\n<command-args>last 1 day</command-args>"}}).to_string();
        assert_eq!(
            run(&line),
            vec![User {
                images: vec![],
                skills: vec![],
                ts: None,
                text: "/working-time last 1 day".into()
            }]
        );
        let bare = serde_json::json!({"type":"user","message":{"content":"<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>"}}).to_string();
        assert_eq!(
            run(&bare),
            vec![User {
                images: vec![],
                skills: vec![],
                ts: None,
                text: "/clear".into()
            }]
        );
        let stdout = serde_json::json!({"type":"user","message":{"content":"<local-command-stdout></local-command-stdout>"}}).to_string();
        assert_eq!(run(&stdout), vec![]);
    }
    #[test]
    fn a_compact_shows_once() {
        // Real records (2.1.296): /compact is written as typed, then again in command form after the boundary.
        let lines = [
            serde_json::json!({"type":"user","promptId":"8d7729fb","message":{"role":"user","content":"/compact"}}),
            serde_json::json!({"type":"system","subtype":"compact_boundary","content":"Conversation compacted","compactMetadata":{"trigger":"manual","preTokens":564_250,"postTokens":20_000}}),
            serde_json::json!({"type":"user","promptId":"8d7729fb","isCompactSummary":true,"message":{"role":"user","content":"This session is being continued from a previous conversation that ran out of context."}}),
            serde_json::json!({"type":"user","promptId":"8d7729fb","isMeta":true,"message":{"role":"user","content":"<local-command-caveat>Caveat: the command below was run directly.</local-command-caveat>"}}),
            serde_json::json!({"type":"user","promptId":"8d7729fb","message":{"role":"user","content":"<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>"}}),
            serde_json::json!({"type":"user","promptId":"8d7729fb","message":{"role":"user","content":"<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>"}}),
        ]
        .map(|v| v.to_string())
        .join("\n");
        assert_eq!(
            run(&lines),
            vec![User {
                images: vec![],
                skills: vec![],
                ts: None,
                text: "/compact".into()
            }]
        );
        // 2.1.278 gives the command-form copy a new prompt id.
        let older = lines
            .lines()
            .map(|l| match l.contains("<command-name>") {
                true => l.replace("8d7729fb", "574dfbdb"),
                false => l.to_string(),
            })
            .collect::<Vec<_>>()
            .join("\n");
        assert_ne!(older, lines);
        assert_eq!(run(&older).len(), 1);
        // A cancelled /compact writes no boundary, only the two copies and an error.
        let cancelled = [
            serde_json::json!({"type":"user","promptId":"19a7c506","message":{"content":"/compact"}}),
            serde_json::json!({"type":"user","promptId":"dfcb3e63","message":{"content":"<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>"}}),
            serde_json::json!({"type":"system","subtype":"local_command","content":"<local-command-stderr>AbortError: Compaction canceled.</local-command-stderr>"}),
        ]
        .map(|v| v.to_string())
        .join("\n");
        assert_eq!(run(&cancelled).len(), 1);
        // Typed mid-turn, it runs when the turn ends: the turn's items come between the copies.
        let cmd = "<command-name>/compact</command-name>\n<command-args></command-args>";
        let mid_turn = [
            serde_json::json!({"type":"user","message":{"content":"/compact"}}),
            serde_json::json!({"type":"assistant","message":{"content":[{"type":"text","text":"done"}]}}),
            serde_json::json!({"type":"user","message":{"content":cmd}}),
        ]
        .map(|v| v.to_string())
        .join("\n");
        assert_eq!(run(&mid_turn).len(), 2);
        // A command run twice in command form shows twice; so does one typed again later.
        let twice = [
            serde_json::json!({"type":"user","message":{"content":cmd}}),
            serde_json::json!({"type":"user","message":{"content":cmd}}),
            serde_json::json!({"type":"user","message":{"content":"/compact"}}),
            serde_json::json!({"type":"user","message":{"content":"hi"}}),
            serde_json::json!({"type":"user","message":{"content":cmd}}),
        ]
        .map(|v| v.to_string())
        .join("\n");
        assert_eq!(run(&twice).len(), 5);
        // The same command sent again is a new prompt and shows again.
        let again = format!(
            "{lines}\n{}",
            serde_json::json!({"type":"user","promptId":"9e8f","message":{"role":"user","content":"/compact"}})
        );
        assert_eq!(run(&again).len(), 2);
    }
    #[test]
    fn shows_shell_commands_and_their_output() {
        let input = serde_json::json!({"type":"user","message":{"content":"<bash-input> ls -la ~/x</bash-input>"}}).to_string();
        assert_eq!(
            run(&input),
            vec![ShellCommand {
                ts: None,
                command: "ls -la ~/x".into()
            }]
        );
        let out = serde_json::json!({"type":"user","message":{"content":"<bash-stdout>a\nb</bash-stdout><bash-stderr>oops</bash-stderr>"}}).to_string();
        assert_eq!(
            run(&out),
            vec![ShellOutput {
                ts: None,
                stdout: "a\nb".into(),
                stderr: "oops".into()
            }]
        );
        let block = serde_json::json!({"type":"user","message":{"content":[{"type":"text","text":"<bash-input>pwd</bash-input>"}]}}).to_string();
        assert_eq!(
            run(&block),
            vec![ShellCommand {
                ts: None,
                command: "pwd".into()
            }]
        );
        let empty = serde_json::json!({"type":"user","message":{"content":"<bash-stdout></bash-stdout><bash-stderr></bash-stderr>"}}).to_string();
        assert_eq!(run(&empty), vec![]);
    }
    #[test]
    fn truncates_long_shell_output() {
        let big = "x".repeat(20_000);
        let line = serde_json::json!({"type":"user","message":{"content":format!("<bash-stdout>{big}</bash-stdout><bash-stderr></bash-stderr>")}}).to_string();
        match &run(&line)[..] {
            [ShellOutput { stdout, .. }] => {
                assert!(stdout.len() < 17_000 && stdout.ends_with("(truncated)"))
            }
            other => panic!("{other:?}"),
        }
    }
    #[test]
    fn skips_system_prompts() {
        let note = serde_json::json!({"type":"user","promptSource":"system","origin":{"kind":"task-notification"},"message":{"content":"<task-notification>\n<task-id>a1</task-id>\n<summary>Agent \"Research\" finished</summary>\n</task-notification>"}}).to_string();
        assert_eq!(
            run(&note),
            vec![System {
                ts: None,
                text: "Agent \"Research\" finished".into(),
                task: None
            }]
        );
        let bare = serde_json::json!({"type":"user","promptSource":"system","message":{"content":"<task-notification>\n<task-id>a1</task-id>\n</task-notification>"}}).to_string();
        assert_eq!(run(&bare), vec![]);
        let typed = serde_json::json!({"type":"user","promptSource":"typed","origin":{"kind":"human"},"message":{"content":"ok"}}).to_string();
        assert_eq!(
            run(&typed),
            vec![User {
                images: vec![],
                skills: vec![],
                ts: None,
                text: "ok".into()
            }]
        );
    }
    #[test]
    fn truncates_long_results() {
        let big = "x".repeat(20_000);
        let line = serde_json::json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t","content": big}]}}).to_string();
        match &run(&line)[0] {
            ToolResult { output, .. } => {
                assert!(output.len() < 16_500);
                assert!(output.ends_with("… (truncated)"));
            }
            o => panic!("{o:?}"),
        }
    }
    #[test]
    fn truncates_on_char_boundary() {
        // 3-byte chars; 16384 is not a multiple of 3 boundary issue: 16384 % 3 == 1
        let big = "€".repeat(10_000);
        let line = serde_json::json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t","content": big}]}}).to_string();
        match &run(&line)[0] {
            ToolResult { output, .. } => {
                assert!(output.len() < 16_500);
                assert!(output.ends_with("… (truncated)"));
            }
            o => panic!("{o:?}"),
        }
    }
    use crate::transcript::{ChatMeta, ImageRef};
    fn run_with(text: &str) -> (Vec<ChatItem>, Vec<(String, String, Vec<u8>)>, ClaudeParser) {
        let mut p = ClaudeParser::default();
        let mut sink: Vec<(String, String, Vec<u8>)> = vec![];
        let mut out = vec![];
        for l in text.lines() {
            if let ParserOutput::Append(v) = p.push_line(l, &mut sink) {
                out.extend(v)
            }
        }
        (out, sink, p)
    }
    fn png(data: &str) -> serde_json::Value {
        serde_json::json!({"type":"image","source":{"type":"base64","media_type":"image/png","data":data}})
    }
    fn queued(prompt: serde_json::Value, kind: &str) -> String {
        serde_json::json!({"type":"attachment","uuid":"q1","timestamp":"2026-10-04T08:51:36.240Z","isSidechain":false,"attachment":{"type":"queued_command","prompt":prompt,"commandMode":"prompt","origin":{"kind":kind}}}).to_string()
    }
    #[test]
    fn shows_messages_sent_mid_turn() {
        let (items, _, _) = run_with(&queued("ssh lên demo2 để check".into(), "human"));
        assert_eq!(
            items,
            vec![User {
                ts: Some("2026-10-04T08:51:36.240Z".into()),
                text: "ssh lên demo2 để check".into(),
                skills: vec![],
                images: vec![],
            }]
        );
        let with_image = queued(
            serde_json::json!([{"type":"text","text":"[Image #1] look"}, png("AQID")]),
            "human",
        );
        let (items, sink, _) = run_with(&with_image);
        assert_eq!(
            items,
            vec![User {
                ts: Some("2026-10-04T08:51:36.240Z".into()),
                text: "[Image #1] look".into(),
                skills: vec![],
                images: vec![ImageRef {
                    reference: "q1:1".into(),
                    media_type: "image/png".into()
                }],
            }]
        );
        assert_eq!(sink.len(), 1);
        // A subagent's hand-back rides the same queue but is not the user's words.
        assert_eq!(
            run(&queued(
                "<agent-message>done</agent-message>".into(),
                "peer"
            )),
            vec![]
        );
    }
    fn queue_op(op: &str, content: Option<&str>) -> String {
        let mut v = serde_json::json!({"type":"queue-operation","operation":op,"timestamp":"2026-10-09T09:07:59.214Z","sessionId":"s"});
        if let Some(c) = content {
            v["content"] = c.into();
        }
        v.to_string()
    }
    fn queued_now(lines: &[String]) -> Vec<String> {
        run_with(&lines.join("\n")).2.meta().queued
    }
    #[test]
    fn a_message_sent_mid_turn_waits_in_the_queue_until_claude_reads_it() {
        let sent = queue_op("enqueue", Some("vụ skill sao không commit đi?"));
        let (items, _, p) = run_with(&sent);
        assert_eq!(items, vec![]);
        assert_eq!(
            p.meta().queued,
            vec!["vụ skill sao không commit đi?".to_string()]
        );
        // Read mid-turn: removed from the queue, shown as the user's message.
        let read = [
            sent.clone(),
            queue_op("remove", Some("vụ skill sao không commit đi?")),
            queued("vụ skill sao không commit đi?".into(), "human"),
        ];
        let (items, _, p) = run_with(&read.join("\n"));
        assert_eq!(p.meta().queued, Vec::<String>::new());
        assert!(
            matches!(&items[..], [User { text, .. }] if text == "vụ skill sao không commit đi?")
        );
    }
    #[test]
    fn the_queue_follows_dequeue_pop_all_and_the_cli_s_own_entries() {
        // Dequeue carries no content: it takes the oldest entry, the CLI's own included.
        let task = "<task-notification>\n<task-id>b1</task-id>\n</task-notification>";
        assert_eq!(
            queued_now(&[
                queue_op("enqueue", Some(task)),
                queue_op("enqueue", Some("hi")),
                queue_op("dequeue", None)
            ]),
            vec!["hi".to_string()]
        );
        assert_eq!(
            queued_now(&[queue_op("enqueue", Some("hi")), queue_op("dequeue", None)]),
            Vec::<String>::new()
        );
        assert_eq!(
            queued_now(&[
                queue_op("enqueue", Some("a")),
                queue_op("enqueue", Some("b")),
                queue_op("popAll", Some("a\nb"))
            ]),
            Vec::<String>::new()
        );
        // The CLI's own entries are not the user's words.
        assert_eq!(
            queued_now(&[queue_op("enqueue", Some(task))]),
            Vec::<String>::new()
        );
    }
    #[test]
    fn a_pasted_message_waits_in_the_queue_like_any_other() {
        // A long paste into the CLI is wrapped `<pasted_content id="…">…</pasted_content id="…">`:
        // the user's words all the same, not one of the CLI's own entries.
        let paste = "<pasted_content id=\"b625\">\n➜ ssh ct-prox 'pvesm list local'\nVolid  Format\n</pasted_content id=\"b625\">";
        assert_eq!(
            queued_now(&[queue_op("enqueue", Some(paste))]),
            vec![paste.to_string()]
        );
        // One from another session is not.
        let peer =
            "<cross-session-message from=\"uds:/tmp/cc-socks/1.sock\">hi</cross-session-message>";
        assert_eq!(
            queued_now(&[queue_op("enqueue", Some(peer))]),
            Vec::<String>::new()
        );
    }
    #[test]
    fn a_queued_message_that_shows_up_as_a_prompt_leaves_the_queue() {
        // Should the queue records miss a step, the message must not wait forever.
        let typed =
            serde_json::json!({"type":"user","origin":{"kind":"human"},"message":{"content":"hi"}})
                .to_string();
        assert_eq!(
            queued_now(&[queue_op("enqueue", Some("hi")), typed]),
            Vec::<String>::new()
        );
    }
    #[test]
    fn a_scheduled_prompt_read_as_a_hidden_record_leaves_the_queue() {
        // Seen in a real transcript: an entry left by a Claude process that exited is never
        // dequeued, so the next dequeue takes it instead of the scheduled tick. The tick then
        // arrives as an isMeta record, not shown, yet read: it must not wait forever.
        let orphan = "<task-notification>\n<task-id>b87</task-id>\n</task-notification>";
        let tick = "[Auto tick — orchestrator] Run one pass";
        let read =
            serde_json::json!({"type":"user","isMeta":true,"message":{"content":tick}}).to_string();
        let (items, _, p) = run_with(
            &[
                queue_op("enqueue", Some(orphan)),
                queue_op("enqueue", Some(tick)),
                queue_op("dequeue", None),
                read,
            ]
            .join("\n"),
        );
        assert_eq!(p.meta().queued, Vec::<String>::new());
        // Still hidden from the Chat, as before.
        assert_eq!(items, vec![]);
    }
    #[test]
    fn image_beside_text_attaches_to_the_user_item() {
        let line = serde_json::json!({"type":"user","uuid":"u1","message":{"content":[png("AQID"),{"type":"text","text":"look"}]}}).to_string();
        let (items, sink, _) = run_with(&line);
        assert_eq!(
            items,
            vec![User {
                ts: None,
                text: "look".into(),
                skills: vec![],
                images: vec![ImageRef {
                    reference: "u1:0".into(),
                    media_type: "image/png".into()
                }],
            }]
        );
        assert_eq!(
            sink,
            vec![("u1:0".to_string(), "image/png".to_string(), vec![1, 2, 3])]
        );
    }
    #[test]
    fn image_only_record_gets_an_empty_user_item() {
        let line = serde_json::json!({"type":"user","uuid":"u2","message":{"content":[
            {"type":"image","source":{"type":"base64","media_type":"image/svg+xml","data":"AQID"}},
            png("not base64!"),
            png("AQID")
        ]}})
        .to_string();
        let (items, sink, _) = run_with(&line);
        assert_eq!(
            items,
            vec![User {
                ts: None,
                text: "".into(),
                skills: vec![],
                images: vec![ImageRef {
                    reference: "u2:2".into(),
                    media_type: "image/png".into()
                }],
            }]
        );
        assert_eq!(sink.len(), 1);
    }
    #[test]
    fn no_uuid_no_images() {
        let line = serde_json::json!({"type":"user","message":{"content":[png("AQID"),{"type":"text","text":"x"}]}}).to_string();
        let (items, sink, _) = run_with(&line);
        assert_eq!(
            items,
            vec![User {
                ts: None,
                text: "x".into(),
                images: vec![],
                skills: vec![]
            }]
        );
        assert!(sink.is_empty());
    }
    #[test]
    fn string_content_unchanged() {
        let (items, sink, _) =
            run_with(r#"{"type":"user","uuid":"u3","message":{"content":"plain"}}"#);
        assert_eq!(
            items,
            vec![User {
                ts: None,
                text: "plain".into(),
                images: vec![],
                skills: vec![]
            }]
        );
        assert!(sink.is_empty());
    }
    #[test]
    fn reads_model_and_effort_last_wins() {
        let lines = [
            serde_json::json!({"type":"assistant","effort":"medium","message":{"model":"claude-haiku-4-5","content":[]}}),
            serde_json::json!({"type":"assistant","effort":"high","message":{"model":"claude-opus-5-5","content":[]}}),
            serde_json::json!({"type":"assistant","message":{"model":"<synthetic>","content":[]}}),
            serde_json::json!({"type":"assistant","isSidechain":true,"effort":"low","message":{"model":"claude-sonnet-5-5","content":[]}}),
        ]
        .map(|v| v.to_string())
        .join("\n");
        let (_, _, p) = run_with(&lines);
        assert_eq!(
            p.meta(),
            ChatMeta {
                model: Some("claude-opus-5-5".into()),
                effort: Some("high".into()),
                context_tokens: None,
                queued: vec![],
                alias: None,
                background: vec![],
            }
        );
    }
    #[test]
    fn reads_context_tokens_from_the_last_main_thread_usage() {
        let lines = [
            serde_json::json!({"type":"assistant","message":{"model":"claude-opus-5-5","content":[],"usage":{"input_tokens":1,"cache_read_input_tokens":100,"output_tokens":5}}}),
            serde_json::json!({"type":"assistant","message":{"model":"claude-opus-5-5","content":[],"usage":{"input_tokens":2,"cache_creation_input_tokens":20,"cache_read_input_tokens":300,"output_tokens":7}}}),
            serde_json::json!({"type":"assistant","isSidechain":true,"message":{"model":"claude-haiku-4-5","content":[],"usage":{"input_tokens":9000,"output_tokens":1}}}),
            serde_json::json!({"type":"assistant","message":{"model":"<synthetic>","content":[],"usage":{"input_tokens":0,"output_tokens":0}}}),
        ]
        .map(|v| v.to_string())
        .join("\n");
        let (_, _, p) = run_with(&lines);
        assert_eq!(p.meta().context_tokens, Some(329));
    }
    #[test]
    fn a_compact_boundary_sets_context_tokens_to_what_is_left() {
        let lines = [
            serde_json::json!({"type":"assistant","message":{"model":"claude-opus-5-5","content":[],"usage":{"input_tokens":1,"cache_read_input_tokens":578_000,"output_tokens":5}}}),
            serde_json::json!({"type":"system","subtype":"compact_boundary","content":"Conversation compacted","compactMetadata":{"trigger":"manual","preTokens":578_458,"postTokens":21_738}}),
        ]
        .map(|v| v.to_string())
        .join("\n");
        let (_, _, p) = run_with(&lines);
        assert_eq!(p.meta().context_tokens, Some(21_738));
    }
    #[test]
    fn reads_model_and_effort_from_slash_command_output() {
        let lines = [
            serde_json::json!({"type":"assistant","effort":"medium","message":{"model":"claude-opus-5-5","content":[]}}),
            serde_json::json!({"type":"user","message":{"content":"<local-command-stdout>Set model to `Sonnet 5.5` and saved as your default for new sessions</local-command-stdout>"}}),
            serde_json::json!({"type":"user","message":{"content":"<local-command-stdout>Set effort level to xhigh (saved as your default for new sessions): Deeper reasoning than high, just below maximum (on supported models)</local-command-stdout>"}}),
        ]
        .map(|v| v.to_string())
        .join("\n");
        let (items, _, p) = run_with(&lines);
        assert_eq!(items, vec![]);
        assert_eq!(
            p.meta(),
            ChatMeta {
                model: Some("claude-sonnet-5-5".into()),
                effort: Some("xhigh".into()),
                context_tokens: None,
                queued: vec![],
                alias: None,
                background: vec![],
            }
        );
    }
    #[test]
    fn model_ids_from_display_names() {
        assert_eq!(model_id("Fable 5.1").as_deref(), Some("claude-fable-5-1"));
        assert_eq!(
            model_id("Opus 5 (1M context) (default)").as_deref(),
            Some("claude-opus-5")
        );
        assert_eq!(model_id("Haiku 4.5").as_deref(), Some("claude-haiku-4-5"));
        assert_eq!(model_id(""), None);
    }
    #[test]
    fn no_effort_field_leaves_it_unset() {
        let (_, _, p) = run_with(&serde_json::json!({"type":"assistant","message":{"model":"claude-opus-5-5","content":[]}}).to_string());
        assert_eq!(
            p.meta(),
            ChatMeta {
                model: Some("claude-opus-5-5".into()),
                ..Default::default()
            }
        );
    }
    #[test]
    fn stamps_items_with_the_record_timestamp() {
        let ts = "2026-10-03T00:49:32.966Z";
        let line = serde_json::json!({"type":"assistant","timestamp":ts,"message":{"content":[{"type":"text","text":"a"},{"type":"tool_use","id":"t","name":"Bash","input":{"command":"ls"}}]}}).to_string();
        let items = run(&line);
        assert_eq!(items.len(), 2);
        assert!(items.iter().all(|i| i.ts() == Some(ts)), "{items:?}");
        let bare = run("{\"type\":\"user\",\"message\":{\"content\":\"a\"}}");
        assert_eq!(bare[0].ts(), None);
    }

    use crate::transcript::{BackgroundKind, BackgroundTask, TaskEnd};
    const BASH_STARTED: &str = "Command running in background with ID: bxb95ptkq. Output is being written to: /tmp/bxb95ptkq.output";
    fn bash_call(id: &str, background: bool, description: Option<&str>) -> String {
        let mut input = serde_json::json!({"command":"mise run ci > /tmp/ci.log 2>&1","run_in_background":background});
        if let Some(d) = description {
            input["description"] = d.into();
        }
        serde_json::json!({"type":"assistant","timestamp":"2026-10-10T17:08:00.000Z","message":{"content":[{"type":"tool_use","id":id,"name":"Bash","input":input}]}}).to_string()
    }
    fn agent_call(id: &str) -> String {
        serde_json::json!({"type":"assistant","timestamp":"2026-10-10T17:09:00.000Z","message":{"content":[{"type":"tool_use","id":id,"name":"Agent","input":{"description":"Whole-branch review","prompt":"review"}}]}}).to_string()
    }
    fn tool_result(id: &str, text: &str, is_error: bool) -> String {
        serde_json::json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":id,"content":[{"type":"text","text":text}],"is_error":is_error}]}}).to_string()
    }
    fn notification(id: &str, status: &str, summary: Option<&str>) -> String {
        let summary = summary
            .map(|s| format!("<summary>{s}</summary>\n"))
            .unwrap_or_default();
        serde_json::json!({"type":"user","promptSource":"system","origin":{"kind":"task-notification"},"timestamp":"2026-10-10T17:18:00.000Z","message":{"content":format!("<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>{id}</tool-use-id>\n<output-file>/tmp/b1.output</output-file>\n<status>{status}</status>\n{summary}</task-notification>")}}).to_string()
    }
    fn end(id: &str, status: &str, exit_code: Option<i32>) -> Option<TaskEnd> {
        Some(TaskEnd {
            call_id: id.into(),
            status: status.into(),
            exit_code,
        })
    }
    fn push(p: &mut ClaudeParser, line: &str) -> Vec<ChatItem> {
        match p.push_line(line, &mut Vec::<(String, String, Vec<u8>)>::new()) {
            ParserOutput::Append(v) => v,
            _ => vec![],
        }
    }

    #[test]
    fn a_background_command_runs_until_its_notification() {
        let (_, _, mut p) = run_with(
            &[
                bash_call("t1", true, Some("Run full dotfiles CI in background")),
                tool_result("t1", BASH_STARTED, false),
            ]
            .join("\n"),
        );
        assert_eq!(
            p.meta().background,
            vec![BackgroundTask {
                call_id: "t1".into(),
                kind: BackgroundKind::Bash,
                description: "Run full dotfiles CI in background".into(),
                started: Some("2026-10-10T17:08:00.000Z".into()),
            }]
        );
        let summary =
            "Background command \"Run full dotfiles CI in background\" completed (exit code 0)";
        assert_eq!(
            push(&mut p, &notification("t1", "completed", Some(summary))),
            vec![System {
                ts: Some("2026-10-10T17:18:00.000Z".into()),
                text: summary.into(),
                task: end("t1", "completed", Some(0))
            }]
        );
        assert_eq!(p.meta().background, vec![]);
    }

    #[test]
    fn a_background_agent_runs_until_its_notification() {
        let (_, _, mut p) = run_with(
            &[
                agent_call("a1"),
                tool_result(
                    "a1",
                    "Async agent launched successfully.\nagentId: a18a42ecc9696ac94",
                    false,
                ),
            ]
            .join("\n"),
        );
        let bg = p.meta().background;
        assert_eq!(
            (bg.len(), &bg[0].kind, bg[0].description.as_str()),
            (1, &BackgroundKind::Agent, "Whole-branch review")
        );
        let items = push(
            &mut p,
            &notification("a1", "failed", Some("Agent \"Whole-branch review\" failed")),
        );
        assert!(matches!(&items[..], [System { task, .. }] if *task == end("a1", "failed", None)));
        assert_eq!(p.meta().background, vec![]);
    }

    #[test]
    fn reads_a_non_zero_exit_code() {
        let (_, _, mut p) = run_with(
            &[
                bash_call("t1", true, Some("ci")),
                tool_result("t1", BASH_STARTED, false),
            ]
            .join("\n"),
        );
        let items = push(
            &mut p,
            &notification(
                "t1",
                "failed",
                Some("Background command \"ci\" failed (exit code 1)"),
            ),
        );
        assert!(
            matches!(&items[..], [System { task, .. }] if *task == end("t1", "failed", Some(1)))
        );
    }

    #[test]
    fn a_notification_without_a_summary_still_ends_the_task() {
        let (_, _, mut p) = run_with(
            &[
                bash_call("t1", true, Some("ci")),
                tool_result("t1", BASH_STARTED, false),
            ]
            .join("\n"),
        );
        assert_eq!(
            push(&mut p, &notification("t1", "killed", None)),
            vec![System {
                ts: Some("2026-10-10T17:18:00.000Z".into()),
                text: String::new(),
                task: end("t1", "killed", None)
            }]
        );
        assert_eq!(p.meta().background, vec![]);
    }

    #[test]
    fn a_notification_without_a_call_id_ends_the_task_by_its_task_id() {
        // Older CLIs, and the "didn't finish before the previous session ended"
        // notice on resume, carry only <task-id>.
        let started =
            "Async agent launched successfully.\nagentId: a18a42ecc9696ac94 (internal ID)";
        let note = |status: &str| {
            format!("<task-notification>\n<task-id>a18a42ecc9696ac94</task-id>\n<status>{status}</status>\n<summary>Agent \"Review\" finished</summary>\n</task-notification>")
        };
        let user = serde_json::json!({"type":"user","promptSource":"system","origin":{"kind":"task-notification"},"message":{"content":note("stopped")}}).to_string();
        let queued = serde_json::json!({"type":"attachment","isSidechain":false,"attachment":{"type":"queued_command","prompt":note("completed"),"commandMode":"task-notification","origin":{"kind":"task-notification"}}}).to_string();
        for (line, status) in [(user, "stopped"), (queued, "completed")] {
            let (_, _, mut p) =
                run_with(&[agent_call("a1"), tool_result("a1", started, false)].join("\n"));
            let items = push(&mut p, &line);
            assert!(
                matches!(&items[..], [System { task, .. }] if *task == end("a1", status, None))
            );
            assert_eq!(p.meta().background, vec![]);
        }
    }

    fn bash_started(call: &str, task: &str) -> String {
        [
            bash_call(call, true, Some(task)),
            tool_result(
                call,
                &format!("Command running in background with ID: {task}. Output is being written to: /tmp/{task}.output"),
                false,
            ),
        ]
        .join("\n")
    }

    #[test]
    fn an_older_queued_notification_without_an_origin_ends_the_task() {
        // CLIs before `origin` mark the attachment by `commandMode` alone.
        let (_, _, mut p) = run_with(&bash_started("t1", "bfl2troh8"));
        let prompt = "<task-notification>\n<task-id>bfl2troh8</task-id>\n<tool-use-id>t1</tool-use-id>\n<output-file>/tmp/bfl2troh8.output</output-file>\n<status>completed</status>\n<summary>Background command \"CI\" completed (exit code 0)</summary>\n</task-notification>";
        let line = serde_json::json!({"type":"attachment","isSidechain":false,"timestamp":"2026-09-29T03:02:09.489Z","attachment":{"type":"queued_command","prompt":prompt,"source_uuid":"cb1339eb","commandMode":"task-notification","timestamp":"2026-09-29T03:02:09.489Z"}}).to_string();
        let items = push(&mut p, &line);
        assert!(
            matches!(&items[..], [System { task, .. }] if *task == end("t1", "completed", Some(0)))
        );
        assert_eq!(p.meta().background, vec![]);
    }

    #[test]
    fn an_sdk_notification_ends_the_task() {
        let (_, _, mut p) = run_with(&bash_started("t1", "bi2ag65w9"));
        let line = serde_json::json!({"type":"user","promptSource":"sdk","origin":{"kind":"task-notification"},"message":{"role":"user","content":"<task-notification>\n<task-id>bi2ag65w9</task-id>\n<tool-use-id>t1</tool-use-id>\n<status>completed</status>\n<summary>Background command \"Wait\" completed (exit code 0)</summary>\n</task-notification>"}}).to_string();
        let items = push(&mut p, &line);
        assert!(
            matches!(&items[..], [System { task, .. }] if *task == end("t1", "completed", Some(0)))
        );
        assert_eq!(p.meta().background, vec![]);
    }

    #[test]
    fn a_resume_notice_ends_every_task_it_names() {
        // On resume the CLI stops all orphans in one notification, one <task-id> each.
        let (_, _, mut p) = run_with(
            &[
                bash_started("t1", "b3wm5gfta"),
                bash_started("t2", "bzz7cxw6v"),
                bash_started("t3", "bkeep0001"),
            ]
            .join("\n"),
        );
        let line = serde_json::json!({"type":"user","promptSource":"system","origin":{"kind":"task-notification"},"message":{"content":"<task-notification>\n<task-id>by8u0fun4</task-id>\n<task-id>b3wm5gfta</task-id>\n<task-id>bzz7cxw6v</task-id>\n<task-id>__orphan_summary__:shell</task-id>\n<status>stopped</status>\n<summary>2 background shell command tasks didn't finish before the previous session ended.</summary>\n</task-notification>"}}).to_string();
        let items = push(&mut p, &line);
        assert_eq!(
            items
                .iter()
                .map(|i| match i {
                    System { text, task, .. } => (text.is_empty(), task.clone()),
                    other => panic!("{other:?}"),
                })
                .collect::<Vec<_>>(),
            vec![
                (false, end("t1", "stopped", None)),
                (true, end("t2", "stopped", None)),
            ]
        );
        let left: Vec<_> = p.meta().background.into_iter().map(|t| t.call_id).collect();
        assert_eq!(left, vec!["t3".to_string()]);
    }

    /// Runs the parser over real transcripts and prints every task still running at
    /// the end, to find a notification shape it misses. `LIST` names one file per line:
    /// `find ~/.claude/projects -name '*.jsonl' -mtime -14 > /tmp/list`, then
    /// `LIST=/tmp/list cargo test --release --lib audit_background -- --ignored --nocapture`.
    /// A task whose session is still open is running for real.
    #[test]
    #[ignore = "reads local transcripts"]
    fn audit_background_tasks_left_running() {
        let Ok(list) = std::env::var("LIST").map(std::fs::read_to_string) else {
            return;
        };
        for file in list.unwrap_or_default().lines() {
            let Ok(text) = std::fs::read_to_string(file) else {
                continue;
            };
            let (_, _, p) = run_with(&text);
            for t in p.meta().background {
                let task = p.task_ids.get(&t.call_id).cloned().unwrap_or_default();
                println!("LEFT\t{file}\t{}\t{task}\t{}", t.call_id, t.description);
            }
        }
    }

    /// The record the CLI writes when a task ends while Claude is mid-turn.
    fn attached_notification(id: &str, status: &str, summary: &str) -> String {
        serde_json::json!({"type":"attachment","timestamp":"2026-10-10T19:40:05.000Z","isSidechain":false,"attachment":{"type":"queued_command","prompt":format!("<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>{id}</tool-use-id>\n<output-file>/tmp/b1.output</output-file>\n<status>{status}</status>\n<summary>{summary}</summary>\n<note>n</note>\n<result>r</result>\n</task-notification>"),"commandMode":"task-notification","origin":{"kind":"task-notification"}}}).to_string()
    }

    #[test]
    fn a_queued_notification_ends_the_task() {
        let (_, _, mut p) = run_with(
            &[
                agent_call("a1"),
                tool_result("a1", "Async agent launched successfully.", false),
            ]
            .join("\n"),
        );
        let items = push(
            &mut p,
            &attached_notification("a1", "completed", "Agent \"Review\" finished"),
        );
        assert_eq!(
            items,
            vec![System {
                ts: Some("2026-10-10T19:40:05.000Z".into()),
                text: "Agent \"Review\" finished".into(),
                task: end("a1", "completed", None)
            }]
        );
        assert_eq!(p.meta().background, vec![]);
    }

    #[test]
    fn a_task_ended_by_both_paths_is_shown_once() {
        let (_, _, mut p) = run_with(
            &[
                agent_call("a1"),
                tool_result("a1", "Async agent launched successfully.", false),
            ]
            .join("\n"),
        );
        assert_eq!(
            push(&mut p, &attached_notification("a1", "completed", "done")).len(),
            1
        );
        assert_eq!(
            push(&mut p, &notification("a1", "completed", Some("done"))),
            vec![]
        );
        assert_eq!(
            push(&mut p, &attached_notification("a1", "completed", "done")),
            vec![]
        );
    }

    #[test]
    fn a_repeated_system_notification_is_shown_once() {
        let mut p = ClaudeParser::default();
        assert_eq!(
            push(&mut p, &notification("a1", "completed", Some("done"))).len(),
            1
        );
        assert_eq!(
            push(&mut p, &notification("a1", "completed", Some("done"))),
            vec![]
        );
        // Another task is unaffected.
        assert_eq!(
            push(&mut p, &notification("a2", "completed", Some("done"))).len(),
            1
        );
    }

    #[test]
    fn a_queued_notification_is_not_the_users_words() {
        let items = run(&attached_notification("zz", "completed", "x"));
        assert!(matches!(&items[..], [System { .. }]));
    }

    #[test]
    fn reads_the_last_exit_code_in_the_summary() {
        let items = run(&notification(
            "t1",
            "failed",
            Some("Background command \"echo (exit code 0)\" failed (exit code 2)"),
        ));
        assert!(
            matches!(&items[..], [System { task, .. }] if *task == end("t1", "failed", Some(2)))
        );
    }

    #[test]
    fn unfinished_calls_are_bounded() {
        let mut p = ClaudeParser::default();
        for i in 0..2000 {
            push(&mut p, &agent_call(&format!("a{i}")));
        }
        assert!(p.calls.len() <= 512);
    }

    #[test]
    fn foreground_and_failed_starts_stay_out() {
        let (_, _, p) = run_with(
            &[
                bash_call("t1", false, Some("ls")),
                tool_result("t1", "a\nb", false),
                bash_call("t2", true, Some("ci")),
                tool_result("t2", "Permission to use Bash has been denied.", true),
                serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"r1","name":"Read","input":{"file_path":"/a"}}]}}).to_string(),
                tool_result("r1", BASH_STARTED, false),
            ]
            .join("\n"),
        );
        assert_eq!(p.meta().background, vec![]);
    }

    #[test]
    fn notification_without_a_start_is_shown() {
        let (items, _, p) = run_with(&notification(
            "zz",
            "completed",
            Some("Background command \"x\" completed (exit code 0)"),
        ));
        assert!(
            matches!(&items[..], [System { task, .. }] if *task == end("zz", "completed", Some(0)))
        );
        assert_eq!(p.meta().background, vec![]);
    }

    #[test]
    fn keeps_start_order() {
        let (_, _, mut p) = run_with(
            &[
                bash_call("t1", true, Some("first")),
                tool_result("t1", BASH_STARTED, false),
                bash_call("t2", true, Some("second")),
                tool_result("t2", BASH_STARTED, false),
                bash_call("t3", true, Some("third")),
                tool_result("t3", BASH_STARTED, false),
            ]
            .join("\n"),
        );
        push(
            &mut p,
            &notification("t1", "completed", Some("done (exit code 0)")),
        );
        let names: Vec<_> = p
            .meta()
            .background
            .into_iter()
            .map(|t| t.description)
            .collect();
        assert_eq!(names, vec!["second", "third"]);
    }

    #[test]
    fn describes_a_command_without_a_description_by_its_start() {
        let long = "x".repeat(100);
        let call = serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":long,"run_in_background":true}}]}}).to_string();
        let (_, _, p) = run_with(&[call, tool_result("t1", BASH_STARTED, false)].join("\n"));
        assert_eq!(p.meta().background[0].description, "x".repeat(80));
    }

    fn stop_call(id: &str, name: &str, key: &str, target: &str) -> String {
        serde_json::json!({"type":"assistant","timestamp":"2026-10-10T17:20:00.000Z","message":{"content":[{"type":"tool_use","id":id,"name":name,"input":{key:target}}]}}).to_string()
    }
    /// A TaskStop result as the CLI writes it: content is one JSON string.
    fn stop_result(id: &str, task_id: &str, is_error: bool) -> String {
        let content = serde_json::json!({"message":format!("Successfully stopped task: {task_id} (cd /tmp)"),"task_id":task_id,"task_type":"local_bash"}).to_string();
        let mut block =
            serde_json::json!({"type":"tool_result","tool_use_id":id,"content":content});
        if is_error {
            block["is_error"] = true.into();
        }
        serde_json::json!({"type":"user","timestamp":"2026-10-10T17:20:05.000Z","message":{"content":[block]}}).to_string()
    }
    fn started(id: &str, task: &str) -> Vec<String> {
        vec![
            bash_call(id, true, Some("ci")),
            tool_result(id, &format!("Command running in background with ID: {task}. Output is being written to: /tmp/{task}.output"), false),
        ]
    }
    fn stopped_item() -> ChatItem {
        System {
            ts: Some("2026-10-10T17:20:05.000Z".into()),
            text: String::new(),
            task: end("t1", "stopped", None),
        }
    }
    fn system_items(items: Vec<ChatItem>) -> Vec<ChatItem> {
        items
            .into_iter()
            .filter(|i| matches!(i, System { .. }))
            .collect()
    }

    #[test]
    fn task_stop_ends_a_bash_task_without_a_row() {
        let (_, _, mut p) = run_with(&started("t1", "b9gjyugpx").join("\n"));
        push(&mut p, &stop_call("s1", "TaskStop", "task_id", "b9gjyugpx"));
        let items = push(&mut p, &stop_result("s1", "b9gjyugpx", false));
        assert_eq!(system_items(items), vec![stopped_item()]);
        assert_eq!(p.meta().background, vec![]);
    }

    #[test]
    fn task_stop_ends_an_agent_task_by_agent_id() {
        let (_, _, mut p) = run_with(
            &[
                agent_call("t1"),
                tool_result(
                    "t1",
                    "Async agent launched successfully.\nagentId: a18a42ecc9696ac94 (internal ID)",
                    false,
                ),
            ]
            .join("\n"),
        );
        push(
            &mut p,
            &stop_call("s1", "TaskStop", "task_id", "a18a42ecc9696ac94"),
        );
        let items = push(&mut p, &stop_result("s1", "a18a42ecc9696ac94", false));
        assert_eq!(system_items(items), vec![stopped_item()]);
        assert_eq!(p.meta().background, vec![]);
    }

    #[test]
    fn kill_shell_ends_a_bash_task_by_shell_id() {
        let (_, _, mut p) = run_with(&started("t1", "b9gjyugpx").join("\n"));
        push(
            &mut p,
            &stop_call("s1", "KillShell", "shell_id", "b9gjyugpx"),
        );
        let items = push(&mut p, &stop_result("s1", "b9gjyugpx", false));
        assert_eq!(system_items(items), vec![stopped_item()]);
        assert_eq!(p.meta().background, vec![]);
    }

    #[test]
    fn a_failed_task_stop_keeps_the_task_running() {
        let (_, _, mut p) = run_with(&started("t1", "b9gjyugpx").join("\n"));
        push(&mut p, &stop_call("s1", "TaskStop", "task_id", "b9gjyugpx"));
        let items = push(&mut p, &stop_result("s1", "b9gjyugpx", true));
        assert_eq!(system_items(items), vec![]);
        assert_eq!(p.meta().background.len(), 1);
    }

    #[test]
    fn task_stop_for_an_unknown_id_changes_nothing() {
        let (_, _, mut p) = run_with(&started("t1", "b9gjyugpx").join("\n"));
        push(&mut p, &stop_call("s1", "TaskStop", "task_id", "bnope"));
        let items = push(&mut p, &stop_result("s1", "bnope", false));
        assert_eq!(system_items(items), vec![]);
        assert_eq!(p.meta().background.len(), 1);
    }

    #[test]
    fn a_notification_after_task_stop_is_dropped() {
        let (_, _, mut p) = run_with(&started("t1", "b9gjyugpx").join("\n"));
        push(&mut p, &stop_call("s1", "TaskStop", "task_id", "b9gjyugpx"));
        push(&mut p, &stop_result("s1", "b9gjyugpx", false));
        assert_eq!(
            push(
                &mut p,
                &notification("t1", "killed", Some("stopped (exit code 137)"))
            ),
            vec![]
        );
    }
}
