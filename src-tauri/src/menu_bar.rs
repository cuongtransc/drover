//! The macOS menu bar's Drover menus (File, View, Go, Help). Each shortcut is an item carrying its
//! key; the menu takes the key before the page (ADR 0010) and tells the webview which action to run.

use serde::Deserialize;

/// A Shortcut's keys, as the frontend's `Chord`: ⌘ with these modifiers and one `KeyboardEvent.code`.
#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct Chord {
    pub code: String,
    pub shift: bool,
    pub alt: bool,
    pub ctrl: bool,
}

pub enum Entry {
    Item {
        id: &'static str,
        label: &'static str,
    },
    Sep,
}

impl Entry {
    pub fn id(&self) -> Option<&'static str> {
        match self {
            Entry::Item { id, .. } => Some(id),
            Entry::Sep => None,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Route {
    /// An event for the webview, with its payload.
    Emit(&'static str, Option<String>),
    /// `menu://action` for this action, with whether its key is a held key's repeat.
    Action(String),
    OpenGuide,
}

const fn item(id: &'static str, label: &'static str) -> Entry {
    Entry::Item { id, label }
}

/// Drover's menus, in order, and their items (`action:<ActionId>` items take the user's keys).
pub const LAYOUT: &[(&str, &[Entry])] = &[
    (
        "File",
        &[
            item("action:tabs.new", "New Tab"),
            item("action:files.goto", "Go to File…"),
            Entry::Sep,
            item("file:reveal", "Reveal in Finder"),
            item("file:open", "Open on this Mac"),
            item("file:copy", "Copy Path"),
            Entry::Sep,
            item("action:item.remove", "Remove Item"),
        ],
    ),
    (
        "Edit",
        &[
            item("find:open", "Find…"),
            item("find:next", "Find Next"),
            item("find:prev", "Find Previous"),
        ],
    ),
    (
        "View",
        &[
            item("action:layout.sidebar", "Toggle Sidebar"),
            item("action:layout.focus", "Focus Layout"),
            item("action:lens.toggle", "Toggle Terminal/Chat"),
            item("action:files.toggle", "Toggle Files Panel"),
            item("action:board", "Agent Board"),
            Entry::Sep,
            item("action:font.bigger", "Bigger Font"),
            item("action:font.smaller", "Smaller Font"),
            item("action:font.reset", "Default Font Size"),
        ],
    ),
    (
        "Go",
        &[
            item("action:jump", "Jump to Pane…"),
            item("action:triage.next", "Next Blocked or Review"),
            item("action:triage.prev", "Previous Blocked or Review"),
            Entry::Sep,
            item("action:item.next", "Next Open Item"),
            item("action:item.prev", "Previous Open Item"),
        ],
    ),
    (
        "Help",
        &[
            item("help:guide", "Drover Guide"),
            item("help:shortcuts", "Keyboard Shortcuts…"),
        ],
    ),
];

/// Keys of items that are not app actions (a file's, Find's): fixed, not rebindable, and reserved
/// in `src/shortcuts/chord.ts`.
pub const FIXED_KEYS: &[(&str, &str)] = &[
    ("file:reveal", "CmdOrCtrl+Alt+KeyR"),
    ("file:copy", "CmdOrCtrl+Alt+KeyC"),
    ("find:open", "CmdOrCtrl+KeyF"),
    ("find:next", "CmdOrCtrl+KeyG"),
    ("find:prev", "CmdOrCtrl+Shift+KeyG"),
];

pub const GUIDE_URL: &str =
    "https://github.com/cuongtransc/drover/blob/main/docs/guide/00-index.md";

/// The accelerator of `c`: `CmdOrCtrl`, then Ctrl, Alt, Shift when set, then the key's code.
pub fn accelerator(c: &Chord) -> String {
    let mut out = String::from("CmdOrCtrl");
    for (on, name) in [(c.ctrl, "Ctrl"), (c.alt, "Alt"), (c.shift, "Shift")] {
        if on {
            out.push('+');
            out.push_str(name);
        }
    }
    out.push('+');
    out.push_str(&c.code);
    out
}

/// What a click on menu item `id` does.
pub fn route(id: &str) -> Option<Route> {
    match id {
        "settings" => return Some(Route::Emit("menu://settings", None)),
        "quit" => return Some(Route::Emit(crate::quit_guard::QUIT_REQUESTED, None)),
        "help:guide" => return Some(Route::OpenGuide),
        "help:shortcuts" => return Some(Route::Emit("menu://settings", Some("shortcuts".into()))),
        _ => {}
    }
    if let Some(action) = id.strip_prefix("action:") {
        return (!action.is_empty()).then(|| Route::Action(action.into()));
    }
    if let Some(what) = id.strip_prefix("find:") {
        return matches!(what, "open" | "next" | "prev")
            .then(|| Route::Emit("menu://find", Some(what.into())));
    }
    if let Some(what) = id.strip_prefix("file:") {
        return matches!(what, "reveal" | "open" | "copy")
            .then(|| Route::Emit("menu://file", Some(what.into())));
    }
    None
}

/// Whether the event that chose a menu item is a held key's repeat (macOS repeats a menu's key
/// equivalent while it is held). A click, or anything else, is not.
pub fn key_repeat() -> bool {
    #[cfg(target_os = "macos")]
    // SAFETY: plain AppKit getters on the main thread, where menu events are delivered.
    unsafe {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if app.is_null() {
            return false;
        }
        let event: *mut AnyObject = msg_send![app, currentEvent];
        if event.is_null() {
            return false;
        }
        // NSEventTypeKeyDown
        let kind: usize = msg_send![event, type];
        kind == 10 && msg_send![event, isARepeat]
    }
    #[cfg(not(target_os = "macos"))]
    false
}

/// The items the frontend changes: accelerators of `action:*`, `enabled` of `file:*`.
pub struct MenuBar<R: tauri::Runtime> {
    pub items: std::sync::Mutex<std::collections::HashMap<String, tauri::menu::MenuItem<R>>>,
}

/// Sets each action item's key from the user's bindings (none for a missing or null one), and
/// the fixed keys (File's, Find's), which go while Settings records a key (`fixed_keys` false).
#[tauri::command]
pub fn menu_set_shortcuts(
    bar: tauri::State<'_, MenuBar<tauri::Wry>>,
    bindings: std::collections::HashMap<String, Option<Chord>>,
    fixed_keys: bool,
) -> Result<(), crate::error::AppError> {
    let items = locked(&bar)?;
    for (id, item) in items.iter() {
        let key = if let Some(action) = id.strip_prefix("action:") {
            bindings
                .get(action)
                .cloned()
                .flatten()
                .map(|c| accelerator(&c))
        } else if let Some((_, k)) = FIXED_KEYS.iter().find(|(i, _)| i == id) {
            fixed_keys.then(|| k.to_string())
        } else {
            continue;
        };
        item.set_accelerator(key.as_deref())
            .map_err(|e| crate::error::AppError::new("io", e.to_string()))?;
    }
    Ok(())
}

type Items<'a> =
    std::sync::MutexGuard<'a, std::collections::HashMap<String, tauri::menu::MenuItem<tauri::Wry>>>;

fn locked<'a>(bar: &'a MenuBar<tauri::Wry>) -> Result<Items<'a>, crate::error::AppError> {
    bar.items
        .lock()
        .map_err(|_| crate::error::AppError::new("io", "menu items unavailable"))
}

/// Enables the File items for the file they would act on: on this Mac, elsewhere, or none.
#[tauri::command]
pub fn menu_set_file_target(
    bar: tauri::State<'_, MenuBar<tauri::Wry>>,
    target: String,
) -> Result<(), crate::error::AppError> {
    let items = locked(&bar)?;
    for (id, on) in [
        ("file:reveal", target == "local"),
        ("file:open", target == "local"),
        ("file:copy", target == "local" || target == "remote"),
    ] {
        if let Some(item) = items.get(id) {
            item.set_enabled(on)
                .map_err(|e| crate::error::AppError::new("io", e.to_string()))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn c(code: &str, shift: bool, alt: bool, ctrl: bool) -> Chord {
        Chord {
            code: code.into(),
            shift,
            alt,
            ctrl,
        }
    }

    #[test]
    fn accelerators_for_every_modifier_and_default_key() {
        assert_eq!(
            accelerator(&c("KeyK", false, false, false)),
            "CmdOrCtrl+KeyK"
        );
        assert_eq!(
            accelerator(&c("KeyJ", true, false, false)),
            "CmdOrCtrl+Shift+KeyJ"
        );
        assert_eq!(
            accelerator(&c("BracketLeft", true, false, false)),
            "CmdOrCtrl+Shift+BracketLeft"
        );
        assert_eq!(
            accelerator(&c("Equal", false, false, false)),
            "CmdOrCtrl+Equal"
        );
        assert_eq!(
            accelerator(&c("Digit0", false, false, false)),
            "CmdOrCtrl+Digit0"
        );
        assert_eq!(
            accelerator(&c("KeyR", true, true, true)),
            "CmdOrCtrl+Ctrl+Alt+Shift+KeyR"
        );
        for code in [
            "KeyK",
            "BracketRight",
            "Minus",
            "Comma",
            "Backquote",
            "Space",
            "Tab",
        ] {
            let a = accelerator(&c(code, true, true, true));
            assert!(a.parse::<muda::accelerator::Accelerator>().is_ok(), "{a}");
        }
    }

    #[test]
    fn every_action_is_in_the_layout_once() {
        let ids: Vec<&str> = LAYOUT
            .iter()
            .flat_map(|(_, e)| e.iter())
            .filter_map(Entry::id)
            .collect();
        for a in [
            "jump",
            "triage.next",
            "triage.prev",
            "board",
            "layout.sidebar",
            "layout.focus",
            "lens.toggle",
            "tabs.new",
            "files.toggle",
            "files.goto",
            "item.remove",
            "item.prev",
            "item.next",
            "font.bigger",
            "font.smaller",
            "font.reset",
        ] {
            let want = format!("action:{a}");
            assert_eq!(ids.iter().filter(|i| **i == want).count(), 1, "{a}");
        }
    }

    #[test]
    fn edit_has_find_with_its_fixed_keys() {
        let edit = LAYOUT
            .iter()
            .find(|(t, _)| *t == "Edit")
            .expect("Edit in the layout");
        let ids: Vec<&str> = edit.1.iter().filter_map(Entry::id).collect();
        assert_eq!(ids, ["find:open", "find:next", "find:prev"]);
        for id in ids {
            let (_, key) = FIXED_KEYS
                .iter()
                .find(|(i, _)| *i == id)
                .expect("a fixed key");
            assert!(
                key.parse::<muda::accelerator::Accelerator>().is_ok(),
                "{key}"
            );
        }
    }

    #[test]
    fn routes() {
        assert_eq!(route("action:jump"), Some(Route::Action("jump".into())));
        assert_eq!(
            route("file:reveal"),
            Some(Route::Emit("menu://file", Some("reveal".into())))
        );
        assert_eq!(
            route("help:shortcuts"),
            Some(Route::Emit("menu://settings", Some("shortcuts".into())))
        );
        assert_eq!(route("help:guide"), Some(Route::OpenGuide));
        assert_eq!(
            route("find:next"),
            Some(Route::Emit("menu://find", Some("next".into())))
        );
        assert_eq!(route("find:other"), None);
        assert_eq!(
            route("settings"),
            Some(Route::Emit("menu://settings", None))
        );
        assert_eq!(
            route("quit"),
            Some(Route::Emit("app://quit-requested", None))
        );
        assert_eq!(route("action:"), None);
        assert_eq!(route("other"), None);
    }
}
