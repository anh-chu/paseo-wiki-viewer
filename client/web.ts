import { createElement } from "react";
import { Platform } from "react-native";

// Plugins get no webview, so the Explorer panel embeds the viewer with a DOM
// iframe. That exists only on web and Electron; native clients open a browser.
export const canEmbed = Platform.OS === "web";

export function WikiFrame({ url, title }: { url: string; title: string }) {
  if (!canEmbed) return null;
  const src = new URL(url);
  src.searchParams.set("embed", "1");
  src.searchParams.set("chrome", "1");
  return createElement("iframe", {
    src: src.toString(),
    title,
    referrerPolicy: "no-referrer",
    style: { flex: 1, width: "100%", height: "100%", border: 0 },
  });
}
