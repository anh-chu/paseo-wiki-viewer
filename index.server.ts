import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createWikiService, resolveExternalFile, resolveWorkspaceFile } from "./server/viewer";
import { describeWikiVersion, openWikiFile, prepareWiki, updateWiki, wikiSettings } from "./shared/wiki";

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
    return wiki.prepare(workspace.workspaceDirectory);
  });
  server.handle(openWikiFile, async ({ workspaceId, path }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (!workspace) throw new Error("workspace is unavailable");
    const inside = await resolveWorkspaceFile(workspace.workspaceDirectory, path);
    const scope = inside
      ? { directory: workspace.workspaceDirectory, path: inside }
      : resolveExternalFile(workspace.workspaceDirectory, path);
    if (!scope) throw new Error("file is unavailable");
    const url = new URL((await wiki.prepare(scope.directory)).url);
    url.searchParams.set("file", scope.path);
    return { url: url.toString() };
  });
  server.handle(describeWikiVersion, () => wiki.describeVersion());
  server.handle(updateWiki, () => wiki.update());

  return () => wiki.dispose();
}
