import type { PluginClientContext } from "@getpaseo/plugin/client";
import { WikiPanel } from "./client/panel";
import { requestOpen } from "./client/open-requests";
import { WikiSettings } from "./client/settings";
import { interceptChatFileLinks } from "./client/web";
import { resolveWikiFile } from "./shared/wiki";

const LOOKUP_TTL_MS = 30_000;

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "wiki",
    title: "Wiki Viewer",
    icon: "BookOpen",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: WikiPanel,
  });
  client.addCommandCenterItem({
    id: "open-wiki",
    title: "Open Wiki Viewer",
    icon: "BookOpen",
    keywords: ["wiki", "markdown", "files", "docs"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("wiki", { location: "explorer" });
    },
  });
  client.addSettingsScreen({ id: "viewer", title: "Wiki Viewer", icon: "BookOpen", Component: WikiSettings });
  // Chat file links open in the Wiki Viewer sidebar instead of a file tab.
  // Lookups started on hover are reused by the click for a short while.
  const lookups = new Map<string, { at: number; result: Promise<{ path: string | null; url?: string }> }>();
  const lookup = (target: string, workspaceId: string) => {
    const key = `${workspaceId}\n${target}`;
    const cached = lookups.get(key);
    if (cached && Date.now() - cached.at < LOOKUP_TTL_MS) return cached.result;
    const result = client.rpc(resolveWikiFile, { workspaceId, target });
    result.catch(() => lookups.delete(key));
    if (lookups.size > 200) lookups.clear();
    lookups.set(key, { at: Date.now(), result });
    return result;
  };
  const stopIntercepting = interceptChatFileLinks({
    prefetch: (target, workspaceId) => void lookup(target, workspaceId).catch(() => {}),
    async open(target, workspaceId) {
      const { path, url } = await lookup(target, workspaceId);
      if (!path) return false;
      requestOpen(workspaceId, path, url);
      client.openPanel("wiki", { workspaceId, location: "explorer" });
      return true;
    },
  });
  return stopIntercepting;
}
