/**
 * The named parts of the screen the UI map numbers (docs/design/ui-map.html), in CONTEXT.md's
 * words. `at` is where the number sits as a share of the part's box, `d` a nudge in px from there,
 * so a part that moves takes its number with it. Run `mise run docs:ui-map` after a UI change.
 */
export interface Surface {
  name: string;
  group: "Sidebar" | "Agents column" | "Main area";
  selector: string;
  what: string;
  code: string;
  at: [number, number];
  d?: [number, number];
}

export const SURFACES: Surface[] = [
  { group: "Sidebar", name: "Sidebar", selector: "nav.sidebar", at: [0.5, 0.55], what: "The left column: Bookmarks, Sessions, Machines.", code: "src/sidebar/Sidebar.tsx" },
  { group: "Sidebar", name: "Layout controls", selector: ".layout-controls", at: [0, 0.5], d: [-10, 0], what: "Beside the traffic lights: ⌘B hides the Sidebar, ⇧⌘B the Agents column too.", code: "src/main/LayoutControls.tsx" },
  { group: "Sidebar", name: "Board button", selector: ".board-btn", at: [1, 0.5], d: [11, 0], what: "Opens the Agent Board (⇧⌘D); the count is the agents that need you.", code: ".board-btn in LayoutControls" },
  { group: "Sidebar", name: "Bookmarks", selector: "[aria-label='Bookmarks']", at: [0, 0], d: [142, 39], what: "Workspaces pinned to the top; a closed one waits under the same name.", code: "useLayout().bookmarks" },
  { group: "Sidebar", name: "Sessions filter", selector: ".sidebar .active-toggle", at: [0, 0.5], d: [-13, 0], what: "All | Active on the Sessions header.", code: "useSessionFilter (src/sidebar/activeFilter.ts)" },
  { group: "Sidebar", name: "Session row", selector: "li.session > .row", at: [0, 0.5], d: [122, 0], what: "A Session in the Sidebar.", code: "SessionRow" },
  { group: "Sidebar", name: "Workspace row", selector: ".project-row", at: [0, 0.5], d: [120, 0], what: "A Workspace with agent work, under its Session row.", code: "ProjectRows" },
  { group: "Sidebar", name: "Fold line", selector: ".filter-hidden", at: [0, 0.5], d: [172, 0], what: "“N hidden · idle or stopped”: what the Active filter hides, with Show.", code: ".filter-hidden in GroupTree" },
  { group: "Sidebar", name: "Machines", selector: "li.machine", at: [0, 0.5], d: [142, 0], what: "The machines herdr runs on, local and over SSH.", code: "li.machine in Sidebar" },
  { group: "Agents column", name: "Agents column", selector: "aside.agents", at: [0.5, 0.39], what: "The middle column, headed by the Session name and PANES.", code: "src/agents/AgentList.tsx" },
  { group: "Agents column", name: "Queue chip", selector: ".need-chip", at: [1, 0.5], d: [13, 0], what: "“1 blocked · 1 review”: steps to the next pane that needs you.", code: "SessionQueueChip" },
  { group: "Agents column", name: "Panes filter", selector: ".panes-head .active-toggle", at: [0, 0.5], d: [-17, 0], what: "All | Active on the PANES header.", code: "usePaneFilter, PanesHeader" },
  { group: "Agents column", name: "Workspace header", selector: ".ws-head", at: [0, 0.5], d: [91, 0], what: "A Workspace's name over its Pane rows; + starts an agent in it.", code: ".ws-head in AgentList" },
  { group: "Agents column", name: "Pane row", selector: ".agent-card", at: [0, 0.5], d: [159, 0], what: "A Pane: agent mark, title, lock, status.", code: "AgentCard" },
  { group: "Agents column", name: "Closed section", selector: ".closed-ws", at: [0, 0.5], d: [96, 0], what: "CLOSED and its count: the Session's kept workspaces herdr removed; a click opens one again.", code: "src/agents/ClosedSection.tsx" },
  { group: "Agents column", name: "Lane toggle", selector: ".lane-toggle", at: [0.5, 0], d: [3, -11], what: "“N lanes ›” on an orchestrator's Pane row.", code: ".lane-toggle in AgentList" },
  { group: "Agents column", name: "Files panel", selector: ".files-panel", at: [0, 0], d: [157, 17], what: "Under the Pane rows; ⌘E shows and hides it.", code: "src/files/FilesPanel.tsx" },
  { group: "Agents column", name: "Go to file", selector: ".files-goto", at: [0, 0.5], d: [223, 0], what: "⌘P: find a file by name in the panel's root.", code: "src/files/GoToFile.tsx" },
  { group: "Agents column", name: "Files tree", selector: ".files-tree", at: [0.5, 0], d: [0, 56], what: "The folders and files under the root.", code: "src/files/FileTree.tsx" },
  { group: "Main area", name: "Top bar", selector: ".topbar", at: [0, 0.5], d: [562, 0], what: "The main area's one bar, as tall as the columns' heads: the Open strip, then the Lens switch.", code: "src/main/TopBar.tsx" },
  { group: "Main area", name: "Open strip", selector: ".agent-tabs", at: [0, 0.5], d: [318, 0], what: "The Open items: the Agents and files you opened. Two of one name say where they live; the tooltip has the whole path.", code: "src/main/OpenStrip.tsx" },
  { group: "Main area", name: "Lens switch", selector: ".topbar .seg", at: [0, 0], d: [2, 1], what: "Terminal | Chat for the selected Pane, as two icons.", code: "src/main/LensSwitch.tsx" },
  { group: "Main area", name: "Chat lens", selector: ".chat-lens", at: [0, 0.5], d: [15, 27], what: "The Pane's Transcript as a conversation. Its twin is the Terminal lens.", code: "src/chat/ChatLens.tsx" },
  { group: "Main area", name: "Work block", selector: ".chat-work", at: [0, 0.5], d: [221, 0], what: "One turn's work folded under “Worked for …”.", code: "src/chat/WorkBlockView.tsx" },
  { group: "Main area", name: "Queued messages", selector: ".chat-queued .chat-bubble", at: [0, 0.5], d: [-66, 0], what: "Sent mid-turn, not read by the agent yet.", code: "src/chat/QueuedMessages.tsx" },
  { group: "Main area", name: "Working line", selector: ".chat-working", at: [0, 0.5], d: [121, 2], what: "The spinner and “Working 1m 23s”, counted from the prompt, while the agent works.", code: "src/chat/WorkingIndicator.tsx" },
  { group: "Main area", name: "Composer chips", selector: ".composer-quick", at: [1, 0.5], d: [19, 0], what: "Quick replies above the message box.", code: ".composer-quick in Composer" },
  { group: "Main area", name: "Composer keys", selector: ".composer-keys", at: [0, 0.5], d: [-16, 0], what: "/btw (on while the box holds one), Use suggestion (Tab), and Esc sent to the agent as a key.", code: ".composer-keys in Composer" },
  { group: "Main area", name: "Composer", selector: ".composer-box", at: [0, 0], d: [511, 21], what: "The message box.", code: "src/chat/Composer.tsx" },
  { group: "Main area", name: "Git status line", selector: ".composer-git", at: [1, 0.5], d: [20, 0], what: "Folder, branch and changed files of the Pane's directory.", code: "GitStatusLine (src/chat/GitStatus.tsx)" },
  { group: "Main area", name: "Model label", selector: ".composer-model", at: [0, 0.5], d: [-18, 0], what: "Model · reasoning effort · context used.", code: ".composer-model, src/chat/modelLabel.ts" },
];
