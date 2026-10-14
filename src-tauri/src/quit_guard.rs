//! Quit from the Dock, logout and restart reach `-[NSApplication terminate:]` without passing
//! through Tauri (tao's app delegate has no `applicationShouldTerminate:`, so no
//! `RunEvent::ExitRequested`), and unsaved Drafts would be lost unasked. This module gives tao's
//! delegate that method: with a dirty Draft it cancels the terminate and asks the page, which
//! quits through `app_quit` once the Drafts are settled (ADR-0009).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use tauri::{AppHandle, Emitter};

/// Some Draft is dirty; the page reports it through `app_set_unsaved`.
static UNSAVED: AtomicBool = AtomicBool::new(false);
/// `app_quit` was called: the page has settled the Drafts.
static QUITTING: AtomicBool = AtomicBool::new(false);
static APP: OnceLock<AppHandle> = OnceLock::new();

/// The event that asks the page to settle Drafts and quit, the same one the Quit menu item sends.
pub const QUIT_REQUESTED: &str = "app://quit-requested";

pub fn set_unsaved(unsaved: bool) {
    UNSAVED.store(unsaved, Ordering::SeqCst);
}

pub fn set_quitting() {
    QUITTING.store(true, Ordering::SeqCst);
}

/// Whether a terminate request from the system may end the app now.
fn may_terminate(unsaved: bool, quitting: bool) -> bool {
    !unsaved || quitting
}

/// Called on the main thread for a terminate request: true lets it go on; false means the page
/// was asked instead.
fn on_terminate_request() -> bool {
    if may_terminate(
        UNSAVED.load(Ordering::SeqCst),
        QUITTING.load(Ordering::SeqCst),
    ) {
        return true;
    }
    let Some(app) = APP.get() else {
        return true;
    };
    match app.emit(QUIT_REQUESTED, ()) {
        Ok(()) => false,
        Err(err) => {
            // Nobody can ask, so the edits cannot be saved: never trap the user in the app.
            tracing::warn!("emit {QUIT_REQUESTED} failed, quitting: {err}");
            true
        }
    }
}

/// Installs the guard; call once from `setup`, after tao made its delegate class.
pub fn install(app: &AppHandle) {
    if APP.set(app.clone()).is_err() {
        return;
    }
    #[cfg(target_os = "macos")]
    mac::install();
}

#[cfg(target_os = "macos")]
mod mac {
    use objc2::ffi::class_addMethod;
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::sel;

    /// tao's `NSApplicationDelegate` class (tao 0.37 `platform_impl/macos/app_delegate.rs`).
    const DELEGATE_CLASS: &std::ffi::CStr = c"TaoAppDelegateParent";
    /// `NSApplicationTerminateReply`.
    const TERMINATE_CANCEL: usize = 0;
    const TERMINATE_NOW: usize = 1;

    extern "C-unwind" fn should_terminate(
        _this: *mut AnyObject,
        _cmd: Sel,
        _sender: *mut AnyObject,
    ) -> usize {
        if super::on_terminate_request() {
            TERMINATE_NOW
        } else {
            TERMINATE_CANCEL
        }
    }

    pub fn install() {
        let Some(class) = AnyClass::get(DELEGATE_CLASS) else {
            tracing::warn!("quit guard: no {DELEGATE_CLASS:?} class; Dock Quit will not ask");
            return;
        };
        type Method = extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> usize;
        // SAFETY: `Imp` is the untyped method pointer; the runtime calls it with the
        // (self, _cmd, sender) -> NSUInteger signature declared by the "Q@:@" encoding below.
        let imp: Imp = unsafe { std::mem::transmute::<Method, Imp>(should_terminate) };
        // SAFETY: the class is registered; adding a method is allowed at any time and leaves an
        // existing implementation untouched (it returns NO then).
        let added = unsafe {
            class_addMethod(
                class as *const AnyClass as *mut AnyClass,
                sel!(applicationShouldTerminate:),
                imp,
                c"Q@:@".as_ptr(),
            )
        };
        if added.as_bool() {
            tracing::info!("quit guard installed");
        } else {
            tracing::warn!(
                "quit guard: tao already answers applicationShouldTerminate:, left as is"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminates_unless_a_draft_is_dirty_and_the_page_has_not_settled_it() {
        assert!(may_terminate(false, false));
        assert!(!may_terminate(true, false));
        assert!(may_terminate(true, true));
        assert!(may_terminate(false, true));
    }
}
