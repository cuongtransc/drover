# 01 · Files

The **Files panel** sits under the Pane rows in the Agents column and shows the selected Workspace's folder, on
whichever Machine it lives.

| To | Do |
|---|---|
| Open the panel on a Workspace | **Browse files** on its Workspace header, or ⌘E (**Toggle Files panel**: shows it with the tree focused, or hides it; change the key in Settings → Shortcuts) |
| Find a file by name | ⌘P (**Go to file**) |
| See what changed | The **CHANGED** group above the tree lists git's changes under the root |
| Read a file | Click it: it opens as an item in the **Open strip**, next to the open agents. The **File viewer** has Copy path, Copy contents, an Outline for Markdown, and find |
| Copy a file to the Mac | Right-click → **Download**. It lands in `~/Downloads`; a name already there gets `name (1).ext` |
| Copy files to the Workspace | Right-click a folder → **Upload Files…** or **Upload Folder…** (the macOS open panel; drag and drop is off) |
| Show the hidden folders | **Show hidden folders** (the eye) on the panel header |
| Change which folders are hidden | Settings → **Files**: add or remove a folder name, or **Reset to defaults** (`.git`, `node_modules`, `target`, …) |

Drover never edits, renames, deletes or overwrites a file in a Workspace: agents work in the same folders. An upload
whose name is taken gets the next free name instead. Why: [ADR 0005](../adr/0005-files-write-only-by-upload-never-overwrite.md).
