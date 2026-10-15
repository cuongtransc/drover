use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::herdr::types::AgentStatus;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MachineState {
    Disconnected,
    Authenticating,
    Probing,
    Connected,
    Incompatible,
    Error,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MachineView {
    pub id: String,
    pub label: String,
    /// `"local"` or `"ssh"`.
    pub kind: String,
    pub state: MachineState,
    pub error: Option<AppError>,
    pub version: Option<String>,
    /// The login user's home folder, once herdr was found there; paths are shown under `~`.
    pub home: Option<String>,
    pub status: AgentStatus,
    pub sessions: Vec<SessionView>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SessionView {
    pub name: String,
    pub running: bool,
    /// The watcher's view arrived: `workspaces` is herdr's list, which can be empty, not a placeholder.
    pub loaded: bool,
    pub status: AgentStatus,
    pub error: Option<AppError>,
    pub workspaces: Vec<WorkspaceView>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct WorkspaceView {
    pub workspace_id: String,
    pub label: String,
    pub number: u32,
    pub status: AgentStatus,
    pub tabs: Vec<TabView>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TabView {
    pub tab_id: String,
    pub label: String,
    pub number: u32,
    pub status: AgentStatus,
    pub panes: Vec<PaneView>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PaneView {
    pub pane_id: String,
    pub terminal_id: String,
    pub title: String,
    /// A shell's: what it does now (its terminal title, else the command it runs), shown after the title.
    pub activity: Option<String>,
    pub cwd: Option<String>,
    pub agent: Option<String>,
    pub status: AgentStatus,
    /// A shell's: whether a command holds its terminal; None for an agent or when unread.
    pub busy: Option<bool>,
    /// An agent herdr's agent API does not know (started through a wrapper): drive it as a pane.
    pub untracked: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PaneRef {
    pub machine_id: String,
    pub session: String,
    pub pane_id: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PaneStatusEvent {
    pub pane: PaneRef,
    pub status: AgentStatus,
    pub previous: AgentStatus,
    pub title: String,
}
