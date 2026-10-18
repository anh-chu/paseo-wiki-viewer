import type { PluginClientContext } from "@getpaseo/plugin/client";
import { WikiPanel } from "./client/panel";
import { requestOpen } from "./client/open-requests";
import { WikiSettings } from "./client/settings";
import { interceptChatFileLinks } from "./client/web";
import { resolveWikiFile } from "./shared/wiki";

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
  const stopIntercepting = interceptChatFileLinks(async (target, workspaceId) => {
    const { path } = await client.rpc(resolveWikiFile, { workspaceId, target });
    if (!path) return false;
    requestOpen(workspaceId, path);
    client.openPanel("wiki", { workspaceId, location: "explorer" });
    return true;
  });
  return stopIntercepting;
}
