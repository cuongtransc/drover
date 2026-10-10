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
pub mod notify;
pub mod open_file;
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
        .plugin(tauri_plugin_dialog::init())
        .menu(app_menu)
        .on_menu_event(|app, event| {
            if let Some(name) = menu_event(event.id().as_ref()) {
                if let Err(err) = app.emit(name, ()) {
                    tracing::warn!("emit {name} failed: {err}");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
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
            commands::term_open,
            commands::term_write,
            commands::term_resize,
            commands::term_ack,
            commands::term_release,
            commands::term_close,
            commands::chat_open,
            commands::chat_locate,
            commands::chat_fork,
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
            commands::files_image,
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
            tracing::info!("herdr-app starting");
            transport::use_runtime_dir_for(&app.config().identifier);
            notify::init(app.handle());
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

const SETTINGS_MENU_ID: &str = "settings";
const SETTINGS_MENU_TEXT: &str = "Settings…";
const SETTINGS_ACCELERATOR: &str = "CmdOrCtrl+,";

/// The webview event a click on our own menu item sends, if it is one.
fn menu_event(id: &str) -> Option<&'static str> {
    (id == SETTINGS_MENU_ID).then_some("menu://settings")
}

/// The default menu with "Settings… ⌘," where macOS apps keep it (the app menu, after About and
/// its separator), and minus "Close Window": with a single window its Cmd+W quit the app.
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
                if p.text()? == "Close Window" {
                    sub.remove(p)?;
                }
            }
        }
    }
    Ok(menu)
}

/// Daily-rotating log files under `dir`, keeping the 5 most recent.
fn init_logging(dir: std::path::PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    std::fs::create_dir_all(&dir)?;
    let appender = Builder::new()
        .rotation(Rotation::DAILY)
        .filename_prefix("herdr-app")
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
        assert_eq!(menu_event(SETTINGS_MENU_ID), Some("menu://settings"));
        assert_eq!(menu_event("quit"), None);
    }

    #[test]
    fn settings_item_follows_macos_conventions() {
        assert_eq!(SETTINGS_MENU_TEXT, "Settings…");
        assert_eq!(SETTINGS_ACCELERATOR, "CmdOrCtrl+,");
    }
}
