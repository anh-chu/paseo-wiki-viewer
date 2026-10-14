import type { PluginClientContext } from "@getpaseo/plugin/client";
import { WikiPanel } from "./client/panel";
import { WikiSettings } from "./client/settings";

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
  return () => {};
}
