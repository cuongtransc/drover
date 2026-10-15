import { createContext, useContext, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { createPortal } from "react-dom";
import { ContextMenu, type MenuEntry } from "../sidebar/ContextMenu";
import { CopyIcon, GlobeIcon } from "../ui/icons";
import { showToast } from "../ui/Toast";
import { useLinkMenu } from "./linkMenu";
import { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./CopyButton";
import { MermaidBlock } from "./MermaidBlock";
import { PathCode } from "./PathCode";
import { remarkBarePaths } from "./remarkPaths";

/** The fenced block's language, from the `language-x` class rehype-highlight leaves on `<code>`. */
function codeLanguage(node: unknown): string | null {
  const code = (node as { children?: { properties?: { className?: unknown } }[] } | undefined)?.children?.[0];
  const cls = code?.properties?.className;
  const list = Array.isArray(cls) ? cls : [];
  const lang = list.find((c): c is string => typeof c === "string" && c.startsWith("language-"));
  return lang ? lang.slice("language-".length) : null;
}

/** The raw text of a hast node: the fence's source, with rehype-highlight's spans flattened. */
export function nodeText(node: unknown): string {
  const n = node as { value?: unknown; children?: unknown[] } | undefined;
  if (typeof n?.value === "string") return n.value;
  return (n?.children ?? []).map(nodeText).join("");
}

/** A link in Chat: a web page opens in the browser, on a click or from its menu (Drover's, in place
 *  of WebKit's, whose Open Link would load the page into the app). */
export function ExternalLink({ href, children, className, title }: { href?: string; children?: ReactNode; className?: string; title?: string }) {
  const external = !!href && /^https?:\/\//i.test(href);
  const menuOf = useLinkMenu();
  const open = () => {
    if (external) void openUrl(href).catch((err) => console.error("openUrl failed", err));
  };
  const copy = (text: string, done: string) =>
    writeText(text).then(
      () => showToast(done, { alert: false }),
      (e) => showToast(`Cannot copy: ${String((e as { message?: string } | null)?.message ?? e)}`),
    );
  const items = (selected: string): MenuEntry[] => [
    ...(external ? [{ label: "Open in Browser", icon: GlobeIcon, onSelect: open }] : []),
    ...(href ? [{ label: "Copy Link", icon: CopyIcon, onSelect: () => copy(href, "Link copied") }] : []),
    ...(selected ? [{ label: "Copy", icon: CopyIcon, keys: "⌘C", onSelect: () => copy(selected, "Copied") }] : []),
  ];
  return (
    <>
      <a
        href={href}
        className={className}
        title={title}
        onClick={(e) => {
          e.preventDefault();
          open();
        }}
        onMouseDown={menuOf.onMouseDown}
        onContextMenu={menuOf.onContextMenu}
      >
        {children}
      </a>
      {menuOf.menu &&
        createPortal(
          <ContextMenu x={menuOf.menu.x} y={menuOf.menu.y} items={items(menuOf.menu.selected)} onClose={menuOf.close} />,
          document.body,
        )}
    </>
  );
}

/** True inside a markdown link, where an image must not become a second (nested) link. */
export const InLinkContext = createContext(false);

/** True inside a fenced block, whose code is never a path link. */
const InPreContext = createContext(false);

export const mdComponents: Components = {
  pre({ node, children }) {
    const lang = codeLanguage(node);
    const source = nodeText(node).trimEnd();
    if (lang === "mermaid") return <MermaidBlock source={source}>{children}</MermaidBlock>;
    return (
      <div className="chat-code">
        <div className="chat-code-head">
          {lang ?? "code"}
          <CopyButton text={source} label="Copy code" />
        </div>
        <InPreContext.Provider value={true}>
          <pre>{children}</pre>
        </InPreContext.Provider>
      </div>
    );
  },
  // Inline code that names a file (`src/a.ts:12`, `~/shot.png`) opens it; any other stays code.
  code: function Code({ node, className, children }) {
    const inPre = useContext(InPreContext);
    const inLink = useContext(InLinkContext);
    if (inPre || inLink || className) return <code className={className}>{children}</code>;
    return <PathCode text={nodeText(node)}>{children}</PathCode>;
  },
  // A file path written in prose without backticks (`remarkBarePaths`) links the same way.
  ...({ "path-ref": ({ node, children }: { node?: unknown; children?: ReactNode }) => <PathCode text={nodeText(node)} plain>{children}</PathCode> } as Components),
  table({ children }) {
    return (
      <div className="chat-table">
        <table>{children}</table>
      </div>
    );
  },
  a({ href, children }) {
    return (
      <InLinkContext.Provider value={true}>
        <ExternalLink href={href}>{children}</ExternalLink>
      </InLinkContext.Provider>
    );
  },
  // Markdown images never become <img>: a remote one would load on render and leak to its host.
  img: function Img({ src, alt }) {
    const inLink = useContext(InLinkContext);
    const text = alt || src || "";
    if (!inLink && typeof src === "string" && /^https?:\/\//i.test(src)) {
      return (
        <ExternalLink href={src} className="chat-image-link" title={src}>
          {text}
        </ExternalLink>
      );
    }
    return <span className="chat-image-link">{text}</span>;
  },
};
export const remarkPlugins = [remarkGfm, remarkBarePaths];
export const rehypePlugins = [[rehypeHighlight, { detect: false }]] as never;
