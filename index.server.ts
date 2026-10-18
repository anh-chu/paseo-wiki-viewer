import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createWikiService, resolveWorkspaceFile, warmFileIndex } from "./server/viewer";
import { describeWikiVersion, prepareWiki, resolveWikiFile, updateWiki, wikiSettings } from "./shared/wiki";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(wikiSettings);
  const wiki = createWikiService(async () => {
    const current = await settings.read();
    if (current.status !== "ready") throw new Error("Wiki Viewer settings are invalid; fix them in Settings");
    return current.values;
  });

  server.handle(prepareWiki, async ({ workspaceId }, { paseo }) => {
    // Resolve the directory on the daemon so a client cannot pick an arbitrary root.
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (!workspace) throw new Error("workspace is unavailable");
    // Chat links in this workspace resolve against a file list; start building it.
    warmFileIndex(workspace.workspaceDirectory);
    return wiki.prepare(workspace.workspaceDirectory);
  });
  server.handle(resolveWikiFile, async ({ workspaceId, target }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    return { path: workspace ? await resolveWorkspaceFile(workspace.workspaceDirectory, target) : null };
  });
  server.handle(describeWikiVersion, () => wiki.describeVersion());
  server.handle(updateWiki, () => wiki.update());

  return () => wiki.dispose();
}
