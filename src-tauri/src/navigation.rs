//! Where the app's webview may go. It stays on the app's own pages: a link that would load a web
//! page into it (WebKit's "Open Link" on a right-clicked link in Chat) opens in the browser instead,
//! and anything else is refused. A window sent to a website would lose the app until it restarts
//! (and Tauri's CVE-2023-31134 came from such a redirect).

use tauri::Url;

#[derive(Debug, PartialEq, Eq)]
pub enum Nav {
    /// The app's own page, or a frame it made (a PDF's `blob:`).
    Allow,
    /// A web page: the browser opens it.
    Browser,
    Deny,
}

/// What a navigation to `url` does; `dev` also allows Vite's dev server.
pub fn decide(url: &Url, dev: bool) -> Nav {
    match url.scheme() {
        "tauri" => Nav::Allow,
        "blob" | "about" => Nav::Allow,
        "http" | "https" => {
            let vite = url.host_str() == Some("localhost") && url.port() == Some(1420);
            if dev && vite {
                Nav::Allow
            } else {
                Nav::Browser
            }
        }
        _ => Nav::Deny,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(url: &str, dev: bool) -> Nav {
        decide(&Url::parse(url).unwrap(), dev)
    }

    #[test]
    fn the_app_and_its_frames_stay() {
        assert_eq!(d("tauri://localhost/", false), Nav::Allow);
        assert_eq!(d("tauri://localhost/index.html#x", false), Nav::Allow);
        assert_eq!(d("blob:tauri://localhost/3b3fbf68", false), Nav::Allow);
        assert_eq!(d("about:blank", false), Nav::Allow);
    }

    #[test]
    fn a_web_page_goes_to_the_browser() {
        assert_eq!(d("https://example.com/", false), Nav::Browser);
        assert_eq!(d("http://example.com/a?b", true), Nav::Browser);
    }

    #[test]
    fn vite_only_in_dev() {
        assert_eq!(d("http://localhost:1420/", true), Nav::Allow);
        assert_eq!(d("http://localhost:1420/", false), Nav::Browser);
        assert_eq!(d("http://localhost:1421/", true), Nav::Browser);
    }

    #[test]
    fn anything_else_is_refused() {
        assert_eq!(d("file:///etc/passwd", false), Nav::Deny);
        assert_eq!(d("javascript:alert(1)", false), Nav::Deny);
        assert_eq!(d("data:text/html,<b>x</b>", false), Nav::Deny);
        assert_eq!(d("mailto:a@b.c", false), Nav::Deny);
    }
}
