//! Needs a real herdr on PATH. Run with
//! `cargo test --test session_rename_herdr -- --ignored --test-threads=1`.
use drover_lib::machines::MachineManager;
use drover_lib::transport::parse_session_list;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

const FROM: &str = "herdrapp-test-rename-a";
const TO: &str = "herdrapp-test-rename-b";

fn herdr(args: &[&str]) -> String {
    let out = Command::new("herdr")
        .args(args)
        .stdin(Stdio::null())
        .output()
        .expect("run herdr");
    String::from_utf8_lossy(&out.stdout).into_owned()
}

/// Stops and deletes both test sessions, even when the test fails.
struct SessionGuard;
impl Drop for SessionGuard {
    fn drop(&mut self) {
        for s in [FROM, TO] {
            herdr(&["session", "stop", s]);
            herdr(&["session", "delete", "--", s]);
        }
    }
}

/// `Some(running)` when herdr lists the session.
fn listed(name: &str) -> Option<bool> {
    parse_session_list(&herdr(&["session", "list"]))
        .into_iter()
        .find(|s| s.name == name)
        .map(|s| s.running)
}

async fn wait_for(what: &str, cond: impl Fn() -> bool) {
    for _ in 0..100 {
        if cond() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("timed out waiting for {what}");
}

fn start(name: &str) {
    Command::new("herdr")
        .args(["--session", name, "server"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn herdr server");
}

#[tokio::test]
#[ignore]
async fn renames_a_stopped_session_keeping_its_workspaces() {
    let _guard = SessionGuard;
    start(FROM);
    wait_for("the session to run", || listed(FROM) == Some(true)).await;
    herdr(&[
        "--session",
        FROM,
        "workspace",
        "create",
        "--cwd",
        "/tmp",
        "--label",
        "rename-marker",
    ]);
    herdr(&["session", "stop", FROM]);
    wait_for("the session to stop", || listed(FROM) == Some(false)).await;

    let d = tempfile::tempdir().unwrap();
    let mgr = MachineManager::new(d.path().join("m.json"), Arc::new(|_| {}));
    mgr.connect("local").await.expect("connect local");
    mgr.rename_session("local", FROM, TO).await.expect("rename");

    assert_eq!(listed(FROM), None);
    assert_eq!(listed(TO), Some(false));
    assert!(mgr.views()[0]
        .sessions
        .iter()
        .any(|s| s.name == TO && !s.running));

    start(TO);
    wait_for("the renamed session to run", || listed(TO) == Some(true)).await;
    let workspaces = herdr(&["--session", TO, "workspace", "list"]);
    assert!(workspaces.contains("rename-marker"), "{workspaces}");
}
