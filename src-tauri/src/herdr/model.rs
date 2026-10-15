use std::collections::{HashMap, HashSet};

use serde_json::Value;

use crate::herdr::types::{AgentInfo, AgentStatus, AgentStatusChanged, Snapshot};
use crate::view::{PaneView, SessionView, TabView, WorkspaceView};

/// Done marks kept on top of herdr's statuses. herdr turns a run ending in its active tab
/// straight to idle (with nobody attached that tab counts as watched), and a focus from any
/// client marks every pane of the focused tab seen, so its `done` cannot be relied on: here a
/// pane counts as done from the end of its run until the app itself focuses it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DoneMarks {
    /// Panes shown done while herdr says idle.
    done: HashSet<String>,
    /// Panes the app focused since their run ended: herdr's done → idle for them is our own seen.
    focused: HashSet<String>,
}

impl DoneMarks {
    /// Record a status transition herdr reported.
    pub fn on_status(&mut self, pane_id: &str, previous: AgentStatus, status: AgentStatus) {
        use AgentStatus::*;
        let ended = matches!(previous, Working | Blocked);
        match status {
            Working | Blocked | Unknown => {
                self.done.remove(pane_id);
                self.focused.remove(pane_id);
            }
            Done => {
                self.focused.remove(pane_id);
            }
            Idle if ended => {
                self.focused.remove(pane_id);
                self.done.insert(pane_id.to_string());
            }
            // herdr marked it seen; only our own focus counts.
            Idle if previous == Done && !self.focused.contains(pane_id) => {
                self.done.insert(pane_id.to_string());
            }
            Idle => {}
        }
    }

    /// The app focused `pane_id`: it is seen.
    pub fn on_focus(&mut self, pane_id: &str) {
        self.done.remove(pane_id);
        self.focused.insert(pane_id.to_string());
    }

    /// `raw`, herdr's status, as the app shows it.
    pub fn status(&self, pane_id: &str, raw: AgentStatus) -> AgentStatus {
        if raw == AgentStatus::Idle && self.done.contains(pane_id) {
            AgentStatus::Done
        } else {
            raw
        }
    }

    /// Forget every pane not in `ids`.
    pub fn retain(&mut self, ids: &[String]) {
        self.done.retain(|p| ids.contains(p));
        self.focused.retain(|p| ids.contains(p));
    }
}

/// What a shell pane is doing, from herdr's `pane.process_info`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShellProc {
    /// Another process group than the shell's own holds the terminal.
    pub busy: bool,
    /// That process's command line, paths cut to their last part; None while idle.
    pub command: Option<String>,
}

/// Shell state by pane id.
pub type Shells = HashMap<String, ShellProc>;

/// Read a `pane.process_info` result; None when it lacks the pids to compare.
pub fn shell_proc(result: &Value) -> Option<ShellProc> {
    let info = result.get("process_info")?;
    let shell = info.get("shell_pid")?.as_u64()?;
    let group = info.get("foreground_process_group_id")?.as_u64()?;
    if group == shell {
        return Some(ShellProc {
            busy: false,
            command: None,
        });
    }
    let command = info
        .get("foreground_processes")
        .and_then(Value::as_array)
        .and_then(|ps| ps.first())
        .and_then(|p| p.get("argv"))
        .and_then(Value::as_array)
        .map(|argv| {
            argv.iter()
                .filter_map(Value::as_str)
                .map(|a| a.rsplit('/').next().unwrap_or(a))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|c| !c.is_empty());
    Some(ShellProc {
        busy: true,
        command,
    })
}

/// A tab label the user chose: herdr's default is the tab's number, and `orch-`, `lane-` and
/// `brief-` mark a role (see `src/agents/roles.ts`), none of which names a shell.
fn user_tab_name(label: &str) -> Option<String> {
    let numbered = !label.is_empty() && label.chars().all(|c| c.is_ascii_digit());
    let role = ["orch-", "lane-", "brief-"]
        .iter()
        .any(|p| label.starts_with(p));
    // The app labels a shell tab it opens unnamed "shell": that names nothing either.
    (!label.is_empty() && !numbered && !role && label != "shell").then(|| label.to_string())
}

/// Build the sidebar tree for a live session. Workspaces and tabs are sorted by
/// `number`, panes keep snapshot order, and every level's status is the rollup of
/// its children, with `marks` applied to pane statuses and `shells` to shell panes. Panes whose
/// tab is missing are dropped.
pub fn session_view(
    name: &str,
    snap: &Snapshot,
    marks: &DoneMarks,
    shells: &Shells,
) -> SessionView {
    let agents: HashMap<&str, &AgentInfo> = snap
        .agents
        .iter()
        .map(|a| (a.pane_id.as_str(), a))
        .collect();

    let mut workspaces: Vec<WorkspaceView> = snap
        .workspaces
        .iter()
        .map(|w| {
            // Snapshot order is herdr's tab order; `number` survives tab.move, so it is no position.
            let tabs: Vec<TabView> = snap
                .tabs
                .iter()
                .filter(|t| t.workspace_id == w.workspace_id)
                .map(|t| {
                    let panes: Vec<PaneView> = snap
                        .panes
                        .iter()
                        .filter(|p| p.tab_id == t.tab_id)
                        .map(|p| {
                            // herdr keeps the session of an agent it no longer detects (one
                            // started through a wrapper), so that still names the agent.
                            let tracked =
                                agents.get(p.pane_id.as_str()).and_then(|a| a.agent.clone());
                            let untracked = tracked.is_none();
                            let agent = tracked
                                .or_else(|| p.agent_session.as_ref().and_then(|s| s.agent.clone()));
                            let untracked = untracked && agent.is_some();
                            let shell = agent.is_none().then(|| shells.get(&p.pane_id)).flatten();
                            let non_empty =
                                |s: &Option<String>| s.clone().filter(|s| !s.is_empty());
                            // An agent keeps herdr's title. A shell reads `name · activity`: what the
                            // user called it, and what it does now.
                            let (title, activity) = match &agent {
                                Some(agent) => (
                                    non_empty(&p.label)
                                        .or_else(|| non_empty(&p.terminal_title_stripped))
                                        .unwrap_or_else(|| agent.clone()),
                                    None,
                                ),
                                None => (
                                    non_empty(&p.label)
                                        .or_else(|| user_tab_name(&t.label))
                                        .unwrap_or_else(|| "Terminal".to_string()),
                                    non_empty(&p.terminal_title_stripped).or_else(|| {
                                        shell.filter(|s| s.busy).and_then(|s| s.command.clone())
                                    }),
                                ),
                            };
                            PaneView {
                                pane_id: p.pane_id.clone(),
                                terminal_id: p.terminal_id.clone(),
                                title,
                                activity,
                                cwd: p.cwd.clone(),
                                agent,
                                status: marks.status(&p.pane_id, p.agent_status),
                                busy: shell.map(|s| s.busy),
                                untracked,
                            }
                        })
                        .collect();
                    TabView {
                        tab_id: t.tab_id.clone(),
                        label: t.label.clone(),
                        number: t.number,
                        status: AgentStatus::rollup(panes.iter().map(|p| p.status)),
                        panes,
                    }
                })
                .collect();
            WorkspaceView {
                workspace_id: w.workspace_id.clone(),
                label: w.label.clone(),
                number: w.number,
                status: AgentStatus::rollup(tabs.iter().map(|t| t.status)),
                tabs,
            }
        })
        .collect();
    workspaces.sort_by_key(|w| w.number);

    SessionView {
        name: name.to_string(),
        running: true,
        loaded: true,
        status: AgentStatus::rollup(workspaces.iter().map(|w| w.status)),
        error: None,
        workspaces,
    }
}

/// What `apply_status` changed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Applied {
    /// Anything visible changed (status or agent): the view must be re-sent.
    pub changed: bool,
    /// The pane's previous status, when the status itself changed.
    pub previous: Option<AgentStatus>,
}

/// Apply a `pane.agent_status_changed` event. Nothing changes for an unknown pane.
pub fn apply_status(snap: &mut Snapshot, ev: &AgentStatusChanged) -> Applied {
    let Some(pane) = snap.panes.iter_mut().find(|p| p.pane_id == ev.pane_id) else {
        return Applied::default();
    };
    let previous = pane.agent_status;
    pane.agent_status = ev.agent_status;

    let mut agent_changed = false;
    match snap.agents.iter_mut().find(|a| a.pane_id == ev.pane_id) {
        Some(a) => {
            a.agent_status = ev.agent_status;
            if ev.agent.is_some() && a.agent != ev.agent {
                a.agent = ev.agent.clone();
                agent_changed = true;
            }
        }
        None if ev.agent.is_some() => {
            snap.agents.push(AgentInfo {
                pane_id: ev.pane_id.clone(),
                agent: ev.agent.clone(),
                agent_status: ev.agent_status,
            });
            agent_changed = true;
        }
        None => {}
    }

    let previous = (previous != ev.agent_status).then_some(previous);
    Applied {
        changed: agent_changed || previous.is_some(),
        previous,
    }
}

/// All pane ids in the snapshot, sorted.
pub fn pane_ids(snap: &Snapshot) -> Vec<String> {
    let mut ids: Vec<String> = snap.panes.iter().map(|p| p.pane_id.clone()).collect();
    ids.sort();
    ids
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::herdr::types::*;
    fn fixture() -> Snapshot {
        serde_json::from_str(include_str!("../../tests/fixtures/snapshot.json")).unwrap()
    }

    #[test]
    fn builds_tree_with_rollups() {
        let v = session_view(
            "default",
            &fixture(),
            &DoneMarks::default(),
            &Shells::default(),
        );
        assert_eq!(v.name, "default");
        assert!(v.running);
        assert!(v.loaded, "a watcher view is herdr's list");
        assert_eq!(v.status, AgentStatus::Blocked);
        assert_eq!(
            v.workspaces
                .iter()
                .map(|w| w.label.as_str())
                .collect::<Vec<_>>(),
            ["drover", "api"]
        );
        let w1 = &v.workspaces[0];
        assert_eq!(w1.status, AgentStatus::Blocked);
        assert_eq!(w1.tabs[0].panes[0].title, "Rewrite");
        assert_eq!(w1.tabs[0].panes[0].agent.as_deref(), Some("claude"));
        assert_eq!(w1.tabs[0].panes[1].title, "pi");
        let w2 = &v.workspaces[1];
        assert_eq!(
            w2.tabs.iter().map(|t| t.label.as_str()).collect::<Vec<_>>(),
            ["1", "logs"]
        );
        assert_eq!(
            w2.tabs[1].panes[0].title, "logs",
            "a plain shell takes the name its tab was given"
        );
        assert_eq!(
            w2.tabs[0].panes[0].title, "Terminal",
            "tab \"1\" is herdr's number"
        );
        assert_eq!(w2.status, AgentStatus::Idle);
    }
    #[test]
    fn an_agent_session_names_the_agent_herdr_did_not_detect() {
        // An agent started through a wrapper (`ccpoke run claude`): herdr records its session
        // but reports no agent and status unknown.
        let mut s = fixture();
        s.panes[3].agent_session = Some(AgentSession {
            agent: Some("claude".into()),
        });
        let v = session_view("default", &s, &DoneMarks::default(), &Shells::default());
        let p = &v.workspaces[1].tabs[1].panes[0];
        assert_eq!(p.agent.as_deref(), Some("claude"));
        assert_eq!(p.status, AgentStatus::Unknown);
        assert_eq!(p.busy, None, "an agent is not a shell");
        assert!(p.untracked, "herdr's agent API does not know it");
        assert!(!v.workspaces[0].tabs[0].panes[0].untracked);
    }
    #[test]
    fn a_shell_is_busy_while_another_process_holds_its_terminal() {
        let mut shells = Shells::default();
        shells.insert(
            "w2:p1".into(),
            ShellProc {
                busy: true,
                command: Some("pnpm vite --port 1441".into()),
            },
        );
        shells.insert(
            "w2:p2".into(),
            ShellProc {
                busy: false,
                command: None,
            },
        );
        let v = session_view("default", &fixture(), &DoneMarks::default(), &shells);
        let running = &v.workspaces[1].tabs[0].panes[0];
        assert_eq!(running.busy, Some(true));
        assert_eq!(running.title, "Terminal", "the command is no name");
        assert_eq!(
            running.activity.as_deref(),
            Some("pnpm vite --port 1441"),
            "a busy untitled shell shows its command"
        );
        let idle = &v.workspaces[1].tabs[1].panes[0];
        assert_eq!(idle.busy, Some(false));
        assert_eq!(idle.title, "logs");
        assert_eq!(idle.activity, None, "an idle shell does nothing");
        assert_eq!(
            v.workspaces[0].tabs[0].panes[0].busy, None,
            "agents carry no busy flag"
        );
    }
    #[test]
    fn a_terminal_title_is_the_activity_and_wins_over_the_command() {
        let mut s = fixture();
        s.panes[2].terminal_title_stripped = Some("ubuntu@ct-hms".into());
        let mut shells = Shells::default();
        shells.insert(
            "w2:p1".into(),
            ShellProc {
                busy: true,
                command: Some("ssh ct-hms".into()),
            },
        );
        let v = session_view("default", &s, &DoneMarks::default(), &shells);
        let p = &v.workspaces[1].tabs[0].panes[0];
        assert_eq!(p.title, "Terminal");
        assert_eq!(p.activity.as_deref(), Some("ubuntu@ct-hms"));
    }
    fn tab_label(label: &str) -> PaneView {
        let mut s = fixture();
        s.tabs[1].label = label.into();
        let v = session_view("default", &s, &DoneMarks::default(), &Shells::default());
        v.workspaces[1].tabs[0].panes[0].clone()
    }
    #[test]
    fn a_tab_the_user_named_names_its_shell() {
        assert_eq!(tab_label("dev").title, "dev");
    }
    #[test]
    fn a_tab_number_role_tab_or_the_apps_shell_label_is_no_name() {
        for label in ["1", "12", "orch-app", "lane-fix", "brief-x", "shell"] {
            assert_eq!(tab_label(label).title, "Terminal", "{label}");
        }
    }
    #[test]
    fn a_pane_label_beats_the_tab_label() {
        let mut s = fixture();
        s.tabs[1].label = "dev".into();
        s.panes[2].label = Some("api".into());
        let v = session_view("default", &s, &DoneMarks::default(), &Shells::default());
        assert_eq!(v.workspaces[1].tabs[0].panes[0].title, "api");
    }
    #[test]
    fn agent_panes_have_no_activity() {
        let mut s = fixture();
        s.tabs[0].label = "dev".into();
        let v = session_view("default", &s, &DoneMarks::default(), &Shells::default());
        let p = &v.workspaces[0].tabs[0].panes[0];
        assert_eq!(p.title, "Rewrite", "an agent keeps its title");
        assert_eq!(p.activity, None);
    }
    #[test]
    fn reads_shell_state_from_process_info() {
        let busy = serde_json::json!({"process_info": {"shell_pid": 2880, "foreground_process_group_id": 58547,
            "foreground_processes": [{"argv": ["/opt/node/bin/node", "/opt/pnpm/bin/pnpm.cjs", "vite", "--port", "1441"], "name": "node", "pid": 58547}]}});
        assert_eq!(
            shell_proc(&busy),
            Some(ShellProc {
                busy: true,
                command: Some("node pnpm.cjs vite --port 1441".into())
            })
        );
        let idle = serde_json::json!({"process_info": {"shell_pid": 99298, "foreground_process_group_id": 99298,
            "foreground_processes": [{"argv": ["-zsh"], "name": "zsh", "pid": 99298}]}});
        assert_eq!(
            shell_proc(&idle),
            Some(ShellProc {
                busy: false,
                command: None
            })
        );
        assert_eq!(
            shell_proc(&serde_json::json!({})),
            None,
            "missing fields: unknown, not idle"
        );
    }
    #[test]
    fn tabs_follow_snapshot_order_not_number() {
        // After tab.move herdr reorders its tab list but keeps each tab's number.
        let mut s = fixture();
        let i = s.tabs.iter().position(|t| t.tab_id == "w2:t1").unwrap();
        let moved = s.tabs.remove(i);
        s.tabs.push(moved);
        let v = session_view("default", &s, &DoneMarks::default(), &Shells::default());
        assert_eq!(
            v.workspaces[1]
                .tabs
                .iter()
                .map(|t| t.tab_id.as_str())
                .collect::<Vec<_>>(),
            ["w2:t2", "w2:t1"]
        );
    }
    #[test]
    fn pane_label_wins_over_terminal_title() {
        let mut s = fixture();
        s.panes[0].label = Some("my pane".into());
        s.panes[1].label = Some(String::new());
        let v = session_view("default", &s, &DoneMarks::default(), &Shells::default());
        assert_eq!(v.workspaces[0].tabs[0].panes[0].title, "my pane");
        assert_eq!(
            v.workspaces[0].tabs[0].panes[1].title, "pi",
            "an empty label falls back"
        );
    }
    #[test]
    fn applies_status_changes() {
        let mut s = fixture();
        let ev = AgentStatusChanged {
            pane_id: "w2:p1".into(),
            agent_status: AgentStatus::Working,
            agent: Some("claude".into()),
        };
        assert_eq!(
            apply_status(&mut s, &ev),
            Applied {
                changed: true,
                previous: Some(AgentStatus::Idle)
            }
        );
        assert_eq!(apply_status(&mut s, &ev), Applied::default());
        let v = session_view("default", &s, &DoneMarks::default(), &Shells::default());
        assert_eq!(
            v.workspaces[1].tabs[0].panes[0].agent.as_deref(),
            Some("claude")
        );
        assert_eq!(v.workspaces[1].status, AgentStatus::Working);
        let unknown = AgentStatusChanged {
            pane_id: "w9:p9".into(),
            agent_status: AgentStatus::Done,
            agent: None,
        };
        assert_eq!(apply_status(&mut s, &unknown), Applied::default());
    }
    #[test]
    fn a_run_ending_in_idle_counts_as_done() {
        use AgentStatus::*;
        let mut m = DoneMarks::default();
        m.on_status("p", Working, Idle);
        assert_eq!(m.status("p", Idle), Done);
        m.on_status("p", Idle, Working);
        assert_eq!(m.status("p", Working), Working);
        m.on_status("p", Working, Blocked);
        m.on_status("p", Blocked, Idle);
        assert_eq!(m.status("p", Idle), Done, "a blocked run ending counts too");
        let mut m = DoneMarks::default();
        m.on_status("p", Unknown, Idle);
        assert_eq!(
            m.status("p", Idle),
            Idle,
            "an agent appearing idle is no completion"
        );
        assert_eq!(m.status("q", Idle), Idle, "other panes are untouched");
    }
    #[test]
    fn herdrs_own_seen_keeps_done_until_the_app_focuses() {
        use AgentStatus::*;
        let mut m = DoneMarks::default();
        m.on_status("p", Working, Done);
        assert_eq!(m.status("p", Done), Done);
        m.on_status("p", Done, Idle); // seen from a TUI, or by a focus on a sibling pane
        assert_eq!(m.status("p", Idle), Done);
        m.on_focus("p");
        assert_eq!(m.status("p", Idle), Idle);
        let mut m = DoneMarks::default();
        m.on_status("p", Working, Done);
        m.on_focus("p");
        m.on_status("p", Done, Idle); // herdr answering our own pane.focus
        assert_eq!(m.status("p", Idle), Idle);
    }
    #[test]
    fn a_focus_before_the_run_ends_does_not_count() {
        use AgentStatus::*;
        let mut m = DoneMarks::default();
        m.on_focus("p");
        m.on_status("p", Working, Idle);
        assert_eq!(m.status("p", Idle), Done);
        let mut m = DoneMarks::default();
        m.on_status("p", Idle, Working);
        m.on_focus("p");
        m.on_status("p", Working, Done);
        m.on_status("p", Done, Idle);
        assert_eq!(m.status("p", Idle), Done);
    }
    #[test]
    fn retain_forgets_gone_panes() {
        use AgentStatus::*;
        let mut m = DoneMarks::default();
        m.on_status("p", Working, Idle);
        m.on_status("q", Working, Idle);
        m.retain(&["q".to_string()]);
        assert_eq!(m.status("p", Idle), Idle);
        assert_eq!(m.status("q", Idle), Done);
    }
    #[test]
    fn session_view_shows_marked_panes_done() {
        let mut m = DoneMarks::default();
        m.on_status("w2:p1", AgentStatus::Working, AgentStatus::Idle);
        let v = session_view("default", &fixture(), &m, &Shells::default());
        assert_eq!(v.workspaces[1].tabs[0].panes[0].status, AgentStatus::Done);
        assert_eq!(v.workspaces[1].status, AgentStatus::Done, "rollups follow");
    }
    #[test]
    fn agent_only_change_is_a_change_without_a_status_transition() {
        let mut s = fixture();
        // w2:p1 is idle with no agent in the fixture.
        let ev = AgentStatusChanged {
            pane_id: "w2:p1".into(),
            agent_status: AgentStatus::Idle,
            agent: Some("pi".into()),
        };
        assert_eq!(
            apply_status(&mut s, &ev),
            Applied {
                changed: true,
                previous: None
            }
        );
        assert_eq!(apply_status(&mut s, &ev), Applied::default());
    }
}
