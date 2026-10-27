import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createWikiService, resolveExternalFile, resolveWorkspaceFile, warmFileIndex } from "./server/viewer";
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
    // Off: report no match, so the click goes on to Paseo's file tab.
    const current = await settings.read();
    if (current.status === "ready" && !current.values.openChatLinks) return { path: null };
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (!workspace) return { path: null };
    const path = await resolveWorkspaceFile(workspace.workspaceDirectory, target);
    if (path) return { path };
    const external = resolveExternalFile(workspace.workspaceDirectory, target);
    if (!external) return { path: null };
    const prepared = await wiki.prepare(external.directory);
    const url = new URL(prepared.url);
    url.searchParams.set("file", external.path);
    return { path: external.path, url: url.toString() };
  });
  server.handle(describeWikiVersion, () => wiki.describeVersion());
  server.handle(updateWiki, () => wiki.update());

  return () => wiki.dispose();
}
