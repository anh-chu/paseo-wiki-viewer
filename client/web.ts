import { createElement, type Ref } from "react";
import { Platform } from "react-native";

// Plugins get no webview, so the Explorer panel embeds the viewer with a DOM
// iframe. That exists only on web and Electron; native clients open a browser.
export const canEmbed = Platform.OS === "web";

// This plugin typechecks without the DOM library. Declare only what this module uses.
interface WebFrame {
  readonly contentWindow: { postMessage(message: unknown, targetOrigin: string): void } | null;
}
interface WebElement {
  closest(selector: string): WebAnchor | null;
  dispatchEvent(event: unknown): boolean;
}
interface WebAnchor {
  getAttribute(name: string): string | null;
  readonly style: { display: string };
}
interface WebMouseEvent {
  readonly target: WebElement | null;
  readonly button: number;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  preventDefault(): void;
  stopImmediatePropagation(): void;
}
interface WebGlobal {
  readonly document: {
    addEventListener(type: "click", listener: (event: WebMouseEvent) => void, capture: boolean): void;
    removeEventListener(type: "click", listener: (event: WebMouseEvent) => void, capture: boolean): void;
  };
  readonly location: { readonly pathname: string };
  readonly MouseEvent: new (type: "click", init: { bubbles: boolean; cancelable: boolean }) => unknown;
}

export function WikiFrame({ url, title, frameRef, onLoad }: { url: string; title: string; frameRef?: Ref<unknown>; onLoad?: () => void }) {
  if (!canEmbed) return null;
  const src = new URL(url);
  src.searchParams.set("embed", "1");
  src.searchParams.set("chrome", "1");
  return createElement("iframe", {
    ref: frameRef,
    onLoad,
    src: src.toString(),
    title,
    referrerPolicy: "no-referrer",
    style: { flex: 1, width: "100%", height: "100%", border: 0 },
  });
}

// Asks a loaded viewer frame to show a workspace-relative file without reloading.
export function postOpenFile(frame: unknown, frameUrl: string, path: string) {
  const win = (frame as WebFrame | null)?.contentWindow;
  if (!win) return;
  const url = new URL(frameUrl);
  win.postMessage({ type: "paseo-wiki-open", grant: url.searchParams.get("grant"), path }, url.origin);
}

/**
 * Catches clicks on chat file links before Paseo opens a file tab. On web, Paseo
 * renders those links as `<a style="display: contents">` around the link text.
 * `open` resolves to false when the link is not a workspace file; the click is
 * then replayed so Paseo handles it as usual. Alt-click always goes to Paseo.
 */
export function interceptChatFileLinks(open: (target: string, workspaceId: string) => Promise<boolean>): () => void {
  if (Platform.OS !== "web") return () => {};
  const web = globalThis as unknown as WebGlobal;
  let replaying = false;
  const onClick = (event: WebMouseEvent) => {
    if (replaying || event.button !== 0 || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const element = event.target;
    const anchor = typeof element?.closest === "function" ? element.closest("a[href]") : null;
    if (!element || !anchor || anchor.style.display !== "contents") return;
    const href = anchor.getAttribute("href");
    if (!href || (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href))) return;
    const match = /^\/h\/[^/]+\/workspace\/([^/?#]+)/.exec(web.location.pathname);
    if (!match) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const replay = () => {
      replaying = true;
      try {
        element.dispatchEvent(new web.MouseEvent("click", { bubbles: true, cancelable: true }));
      } finally {
        replaying = false;
      }
    };
    open(href, decodeURIComponent(match[1]!)).then(
      (handled) => {
        if (!handled) replay();
      },
      replay,
    );
  };
  web.document.addEventListener("click", onClick, true);
  return () => web.document.removeEventListener("click", onClick, true);
}
