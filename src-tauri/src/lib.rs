pub mod attach;
pub mod commands;
pub mod complete;
pub mod error;
pub mod files;
pub mod fonts;
pub mod git;
pub mod herdr;
pub mod lanes;
pub mod layout;
pub mod machines;
pub mod menu_bar;
mod navigation;
pub mod notify;
pub mod open_file;
pub mod quit_guard;
pub mod quota;
pub mod sshconfig;
pub mod transcript;
pub mod transport;
pub mod view;

use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
use tauri::{Emitter, Manager};

use attach::AttachManager;
use machines::{MachineManager, UiEvent};
use tracing_appender::rolling::{Builder, Rotation};
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("navigation-guard")
                .on_navigation(
                    |webview, url| match navigation::decide(url, tauri::is_dev()) {
                        navigation::Nav::Allow => true,
                        navigation::Nav::Browser => {
                            use tauri_plugin_opener::OpenerExt;
                            if let Err(e) = webview.opener().open_url(url.as_str(), None::<&str>) {
                                tracing::warn!("navigation: cannot open {url} in the browser: {e}");
                            }
                            false
                        }
                        navigation::Nav::Deny => {
                            tracing::warn!("navigation: refused {url}");
                            false
                        }
                    },
                )
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .menu(app_menu)
        .on_menu_event(|app, event| match menu_bar::route(event.id().as_ref()) {
            Some(menu_bar::Route::Emit(name, payload)) => {
                if let Err(err) = app.emit(name, payload) {
                    tracing::warn!("emit {name} failed: {err}");
                }
            }
            Some(menu_bar::Route::Action(id)) => {
                let payload = serde_json::json!({ "id": id, "repeat": menu_bar::key_repeat() });
                if let Err(err) = app.emit("menu://action", payload) {
                    tracing::warn!("emit menu://action failed: {err}");
                }
            }
            Some(menu_bar::Route::OpenGuide) => {
                use tauri_plugin_opener::OpenerExt;
                if let Err(err) = app.opener().open_url(menu_bar::GUIDE_URL, None::<&str>) {
                    tracing::warn!("menu: cannot open the guide: {err}");
                }
            }
            None => {}
        })
        .on_window_event(|window, event| {
            // Sessions made outside the app (a terminal, another client) show on return.
            if let tauri::WindowEvent::Focused(true) = event {
                if let Some(mgr) = window.try_state::<Arc<MachineManager>>() {
                    let mgr = mgr.inner().clone();
                    tauri::async_runtime::spawn(async move {
                        mgr.poll_all(machines::FOCUS_POLL_GAP).await
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            menu_bar::menu_set_shortcuts,
            menu_bar::menu_set_file_target,
            commands::app_quit,
            commands::app_set_unsaved,
            commands::machines_list,
            commands::machine_connect,
            commands::machine_disconnect,
            commands::machine_add,
            commands::machine_remove,
            commands::machine_update,
            commands::machine_master_alive,
            commands::ssh_hosts,
            commands::connect_open,
            commands::connect_write,
            commands::connect_ack,
            commands::connect_resize,
            commands::connect_close,
            commands::sessions_refresh,
            commands::session_start,
            commands::session_stop,
            commands::session_delete,
            commands::session_rename,
            commands::herdr_call,
            commands::lanes_list,
            commands::notify_pane,
            commands::image_save_temp,
            commands::open_local_file,
            commands::reveal_local_file,
            commands::term_open,
            commands::term_write,
            commands::term_resize,
            commands::term_ack,
            commands::term_release,
            commands::term_close,
            commands::chat_open,
            commands::chat_locate,
            commands::chat_page,
            commands::chat_image,
            commands::chat_close,
            commands::complete_commands,
            commands::claude_prompt_history,
            commands::complete_files,
            commands::complete_entries,
            commands::complete_dirs,
            commands::chat_git_status,
            commands::files_list_dir,
            commands::files_list_all,
            commands::files_read,
            commands::files_write,
            commands::files_image,
            commands::files_pdf,
            commands::files_first_files,
            commands::files_changed,
            commands::files_watch,
            commands::files_unwatch,
            commands::files_upload,
            commands::files_download,
            commands::system_fonts,
            commands::font_face,
            commands::quota_fetch,
            commands::quota_cta,
            commands::layout_load,
            commands::layout_save,
        ])
        .setup(|app| {
            init_logging(app.path().app_log_dir()?)?;
            tracing::info!("drover starting");
            transport::use_runtime_dir_for(&app.config().identifier);
            let chat_cache = app.path().app_cache_dir()?.join("transcripts");
            transcript::cache::use_dir(chat_cache.clone());
            std::thread::spawn(move || {
                transcript::cache::prune(&chat_cache, transcript::cache::BUDGET)
            });
            notify::init(app.handle());
            quit_guard::install(app.handle());
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(Arc::new(layout::LayoutStore::new(
                dir.join("sidebar-layout.json"),
            )));
            let handle = app.handle().clone();
            let mgr = MachineManager::new(
                dir.join("machines.json"),
                Arc::new(move |e| {
                    let res = match e {
                        UiEvent::Machine(v) => handle.emit("sidebar://machine", v),
                        UiEvent::PaneStatus(p) => handle.emit("pane://status", p),
                    };
                    if let Err(err) = res {
                        tracing::warn!("emit failed: {err}");
                    }
                }),
            );
            let attach = AttachManager::new(std::time::Duration::from_secs(15));
            mgr.set_attach_manager(attach.clone());
            let chats = Arc::new(transcript::ChatManager::default());
            mgr.set_chat_manager(chats.clone());
            app.manage(mgr.clone());
            app.manage(attach);
            app.manage(chats);
            app.manage(Arc::new(files::watch_manager::FilesWatch::default()));
            tauri::async_runtime::spawn(async move { mgr.connect_at_startup().await });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // ControlPersist masters outlive us: end every ssh master on the way out.
                if let Some(mgr) = app.try_state::<Arc<MachineManager>>() {
                    let mgr = mgr.inner().clone();
                    tauri::async_runtime::block_on(async move { mgr.disconnect_all_ssh().await });
                }
            }
        });
}

const QUIT_MENU_ID: &str = "quit";
const SETTINGS_MENU_ID: &str = "settings";
const SETTINGS_MENU_TEXT: &str = "Settings…";
const SETTINGS_ACCELERATOR: &str = "CmdOrCtrl+,";

/// The Quit menu item's text, named after the app as it is installed.
fn quit_label(app_name: &str) -> String {
    format!("Quit {app_name}")
}

/// The default menu with "Settings… ⌘," where macOS apps keep it (the app menu, after About and
/// its separator), and minus "Close Window": with a single window its Cmd+W quit the app. Quit is
/// our own item, routed through the frontend so unsaved Drafts are asked about first.
fn app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    for (i, item) in menu.items()?.into_iter().enumerate() {
        let Some(sub) = item.as_submenu() else {
            continue;
        };
        // On macOS the first submenu is the app menu: About, separator, Services, ...
        if cfg!(target_os = "macos") && i == 0 {
            let settings = MenuItem::with_id(
                app,
                SETTINGS_MENU_ID,
                SETTINGS_MENU_TEXT,
                true,
                Some(SETTINGS_ACCELERATOR),
            )?;
            sub.insert_items(&[&settings, &PredefinedMenuItem::separator(app)?], 2)?;
        }
        for entry in sub.items()? {
            if let MenuItemKind::Predefined(p) = &entry {
                let text = p.text()?;
                if text == "Close Window" {
                    sub.remove(p)?;
                } else if text.starts_with("Quit") {
                    let at = sub
                        .items()?
                        .iter()
                        .position(|i| i.id() == p.id())
                        .unwrap_or(0);
                    sub.remove(p)?;
                    let quit = MenuItem::with_id(
                        app,
                        QUIT_MENU_ID,
                        quit_label(&app.package_info().name),
                        true,
                        Some("CmdOrCtrl+Q"),
                    )?;
                    sub.insert(&quit, at)?;
                }
            }
        }
    }
    add_drover_menus(app, &menu)?;
    Ok(menu)
}

/// Drover's File, Edit, View, Go and Help (`menu_bar::LAYOUT`): File and Help replace the default
/// ones, Find goes at the end of Edit,
/// View's items go above its Enter Full Screen, Go is new after View. The items are kept in
/// `MenuBar` for the frontend to set their keys and File's `enabled`.
fn add_drover_menus<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    menu: &Menu<R>,
) -> tauri::Result<()> {
    use tauri::menu::{IsMenuItem, Submenu};
    let mut kept = std::collections::HashMap::new();
    for (title, entries) in menu_bar::LAYOUT {
        let mut items: Vec<Box<dyn IsMenuItem<R>>> = Vec::new();
        for entry in entries.iter() {
            match entry {
                menu_bar::Entry::Sep => items.push(Box::new(PredefinedMenuItem::separator(app)?)),
                menu_bar::Entry::Item { id, label } => {
                    let key = menu_bar::FIXED_KEYS
                        .iter()
                        .find(|(i, _)| i == id)
                        .map(|(_, k)| *k);
                    // File items wait for a target; action items for the user's keys.
                    let item = MenuItem::with_id(app, *id, *label, !id.starts_with("file:"), key)?;
                    kept.insert(id.to_string(), item.clone());
                    items.push(Box::new(item));
                }
            }
        }
        let refs: Vec<&dyn IsMenuItem<R>> = items.iter().map(|b| b.as_ref()).collect();
        let existing = menu
            .items()?
            .into_iter()
            .position(|i| i.as_submenu().and_then(|s| s.text().ok()).as_deref() == Some(*title));
        match (*title, existing) {
            ("View", Some(at)) => {
                // `existing` found it as a submenu, so this always holds.
                if let Some(view) = menu.items()?[at].as_submenu().cloned() {
                    let mut with_sep = refs.clone();
                    let sep = PredefinedMenuItem::separator(app)?;
                    with_sep.push(&sep);
                    view.insert_items(&with_sep, 0)?;
                }
            }
            ("Edit", Some(at)) => {
                // Find goes below the default Undo … Select All.
                if let Some(edit) = menu.items()?[at].as_submenu().cloned() {
                    let sep = PredefinedMenuItem::separator(app)?;
                    edit.append(&sep)?;
                    edit.append_items(&refs)?;
                }
            }
            (_, Some(at)) => {
                let old = menu.items()?.remove(at);
                menu.remove(&old)?;
                menu.insert(&Submenu::with_items(app, *title, true, &refs)?, at)?;
            }
            (_, None) => {
                // Go: after View, else before Window, else at the end.
                let after_view = menu.items()?.iter().position(|i| {
                    i.as_submenu().and_then(|s| s.text().ok()).as_deref() == Some("View")
                });
                let at = after_view.map(|v| v + 1).unwrap_or(menu.items()?.len());
                menu.insert(&Submenu::with_items(app, *title, true, &refs)?, at)?;
            }
        }
    }
    app.manage(menu_bar::MenuBar {
        items: std::sync::Mutex::new(kept),
    });
    Ok(())
}

/// Daily-rotating log files under `dir`, keeping the 5 most recent.
fn init_logging(dir: std::path::PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(&dir)?;
    let appender = Builder::new()
        .rotation(Rotation::DAILY)
        .filename_prefix("drover")
        .filename_suffix("log")
        .max_log_files(5)
        .build(&dir)?;
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(appender)
        .with_ansi(false)
        .try_init()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_menu_item_opens_settings_in_the_webview() {
        use menu_bar::{route, Route};
        assert_eq!(
            route(SETTINGS_MENU_ID),
            Some(Route::Emit("menu://settings", None))
        );
        assert_eq!(
            route(QUIT_MENU_ID),
            Some(Route::Emit(quit_guard::QUIT_REQUESTED, None))
        );
    }

    #[test]
    fn quit_item_is_named_after_the_app() {
        assert_eq!(quit_label("Drover"), "Quit Drover");
    }

    #[test]
    fn settings_item_follows_macos_conventions() {
        assert_eq!(SETTINGS_MENU_TEXT, "Settings…");
        assert_eq!(SETTINGS_ACCELERATOR, "CmdOrCtrl+,");
    }
}
