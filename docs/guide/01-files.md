# 01 · Files

The **Files panel** sits under the Pane rows in the Agents column and shows the selected Workspace's folder, on
whichever Machine it lives.

| To | Do |
|---|---|
| Open the panel on a Workspace | **Browse files** on its Workspace header, or ⌘E (**Toggle Files panel**: shows it with the tree focused, or hides it; change the key in Settings → Shortcuts) |
| Find a file by name | ⌘P (**Go to file**) |
| See what changed | The **CHANGED** group above the tree lists git's changes under the root |
| Read a file | Click it: it opens as an item in the **Open strip**, next to the open agents. The **File viewer** has Copy path, Reveal in Finder and Open on this Mac (a file on this Mac), Copy contents, an Outline for Markdown, and find |
| Read a PDF | Click it: it shows in WebKit's PDF viewer (up to 20 MB). Pinch or right-click → **Zoom In** to zoom; ⌘+/⌘− change Drover's font size, not the PDF |
| Open a path an agent wrote | Click it in the Chat lens: a file opens in the File viewer (at its `:line`), a folder opens as a list of what is in it, hidden folders too; click a name to open it. On this Mac, ⌘-click hands it to macOS |
| Do more with that path | Right-click it: **Open in Files**, **Open on this Mac**, **Reveal in Finder** (the last two on this Mac only), **Copy Path**, and **Copy** when you had selected text |
| Do the same from the keyboard | Tab to the path, then ↩ (Files), ⌘↩ (this Mac), ⌥⌘R (Reveal in Finder), ⌥⌘C (Copy Path), or ⇧F10 for the menu |
| Open or copy a web link | Click it to open it in the browser; right-click it for **Open in Browser**, **Copy Link**, and **Copy** when you had selected text. A web page never opens inside Drover |
| Copy a file to the Mac | Right-click → **Download**. It lands in `~/Downloads`; a name already there gets `name (1).ext` |
| Copy files to the Workspace | Right-click a folder → **Upload Files…** or **Upload Folder…** (the macOS open panel; drag and drop is off) |
| Read the tree again | ⌘R. On the local Mac it also happens by itself when Drover gets the focus back and when an agent of the Workspace stops working: macOS can drop file events while a build churns files, so the tree may miss a change until then |
| Show the hidden folders | **Show hidden folders** (the eye) on the panel header |
| Change which folders are hidden | Settings → **Files**: add or remove a folder name, or **Reset to defaults** (`.git`, `node_modules`, `target`, …) |

## Edit mode

The File viewer opens in view mode. To change a file's content:

| To | Do |
|---|---|
| Start editing | **Edit** on the viewer header, or ⌘⇧E |
| Save | ⌘S. An item with unsaved changes shows a dot (●) on its Open strip entry |
| Stop editing | **Done**, ⌘⇧E again, or Esc (Esc does nothing while a dialog or the editor's find panel is open) |
| Close or quit with unsaved changes | ⌘W, the red window button, ⌘Q and the Open strip's **Remove**, **Remove Others**, **Remove to the Right** and **Remove All** ask **Save** / **Discard** / **Cancel** first |

Dock → Quit, logging out and restarting ask the same; Cancel keeps Drover open (and stops the logout).

A save never silently overwrites a file that changed after you opened it. If an Agent or a
pane changed the file, a banner says **File changed on disk** with **Reload** (drop your edits, take
the disk version) and **Overwrite** (keep yours). If the file was deleted, the banner says
**File was deleted** with **Save again** and **Close**. Your edits stay as a Draft until you choose.

A path in Chat is a link only when the file is there. A relative path is looked for first where the
agent worked before that message (the files its tools named, the folders it `cd`'d into), then in the
session's folder. One that is nowhere stays plain text.

Not editable (no Edit button): images, PDFs, binary files, truncated files (over 2 MB), files that are not
valid UTF-8, and files that mix line endings.

Drover still never renames, deletes or moves a file in a Workspace. An upload whose name is taken gets the
next free name instead. Why: [ADR 0005](../adr/0005-files-write-only-by-upload-never-overwrite.md), edits:
[ADR 0009](../adr/0009-file-viewer-edits-save-never-silently-overwrites.md).
