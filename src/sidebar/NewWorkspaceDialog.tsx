import { useState } from "react";
import { herdrCall } from "../lib/ipc";
import { paneKey } from "../lib/types";
import { newAgentOnTerminal } from "../settings/lens";
import { useApp } from "../store/app";
import { PathInput } from "../ui/PathInput";
import { setFolder } from "../workspaces/folder";
import { AgentChoice } from "../agents/AgentChoice";
import { launchAgent } from "../agents/launchAgent";

type Agent = "none" | "claude" | "pi";
const AGENTS: readonly Agent[] = ["none", "claude", "pi"];

interface WorkspaceCreated {
  workspace?: { workspace_id: string; label?: string };
  root_pane: { pane_id: string };
}

// A Kept workspace and a Bookmark are keyed by label, so a second live Workspace with one label would share
// them: it reads as kept, and closing it never shows it under Closed. The first free `label-N` keeps them apart.
const uniqueLabel = (label: string, taken: Set<string>) => {
  let n = 2;
  while (taken.has(`${label}-${n}`)) n += 1;
  return `${label}-${n}`;
};

export function NewWorkspaceDialog({
  machineId,
  session,
  defaultCwd,
  onClose,
  onError,
}: {
  machineId: string;
  session: string;
  defaultCwd: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [cwd, setCwd] = useState(defaultCwd);
  const [label, setLabel] = useState("");
  const [agent, setAgent] = useState<Agent>("none");
  const create = async () => {
    onClose();
    // Labels before the call: herdr may list the new Workspace before it replies.
    const taken = new Set(
      useApp.getState().machines[machineId]?.sessions.find((x) => x.name === session)?.workspaces.map((w) => w.label) ?? [],
    );
    try {
      const res = await herdrCall<WorkspaceCreated>(machineId, session, "workspace.create", {
        cwd: cwd.trim() || null,
        label: label.trim() || null,
        focus: false,
      });
      const workspaceId = res.workspace?.workspace_id;
      // herdr names an unlabelled Workspace after its folder, so the label is checked as herdr reports it.
      const created = res.workspace?.label;
      if (workspaceId && created && taken.has(created)) {
        await herdrCall(machineId, session, "workspace.rename", { workspace_id: workspaceId, label: uniqueLabel(created, taken) });
      }
      if (cwd.trim() && workspaceId) {
        setFolder({ machine_id: machineId, session, workspace_id: workspaceId }, cwd);
      }
      if (agent !== "none") {
        // Held on the Terminal when new agents open there; otherwise it opens on Chat once herdr reports it.
        const pane = { machine_id: machineId, session, pane_id: res.root_pane.pane_id };
        if (newAgentOnTerminal()) useApp.getState().setLensOverride(paneKey(pane), "terminal");
        await launchAgent((m, p) => herdrCall(machineId, session, m, p), pane, agent);
      }
    } catch (e) {
      onError((e as { message?: string }).message ?? String(e));
    }
  };
  return (
    <div className="overlay" onMouseDown={onClose}>
      <form
        className="dialog"
        role="dialog"
        aria-label="New workspace"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <h3>New workspace in {session}</h3>
        <PathInput machineId={machineId} label="Folder" autoFocus value={cwd} placeholder="/path/to/repo" onChange={setCwd} />
        <label>
          Label (optional)
          <input spellCheck={false} autoCorrect="off" autoCapitalize="off" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <AgentChoice options={AGENTS} value={agent} onChange={setAgent} />
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Create</button>
        </div>
      </form>
    </div>
  );
}
