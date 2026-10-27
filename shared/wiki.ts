import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const wikiSettings = defineSettings({
  id: "viewer",
  scope: "host",
  version: 1,
  schema: z.object({
    // Clicking a file path in chat opens it in the Wiki Viewer sidebar.
    openChatLinks: z.boolean().default(true),
    // Base URL the client opens, e.g. http://devvm:7791. Empty: http://<daemon hostname>:<port>.
    publicUrl: z.string().default(""),
    // Port of the grant-checking proxy on the daemon machine. 0 picks a free port.
    port: z.number().int().min(0).max(65535).default(0),
    // wiki-viewer install to run. Empty: the managed install under the Paseo home.
    viewerRoot: z.string().default(""),
  }),
});

export const prepareWiki = defineRpc({
  name: "wiki.prepare",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.object({ url: z.string(), expiresAt: z.number() }),
});

export const versionInfo = z.object({
  installed: z.string().nullable(),
  latest: z.string().nullable(),
  latestError: z.string(),
  root: z.string(),
  managed: z.boolean(),
  checkout: z.boolean(),
  updateAvailable: z.boolean(),
});

export const describeWikiVersion = defineRpc({
  name: "wiki.version",
  input: z.object({}),
  output: versionInfo,
});

export const updateWiki = defineRpc({
  name: "wiki.update",
  input: z.object({}),
  output: z.object({ updated: z.boolean(), previous: z.string().nullable(), version: z.string().nullable() }),
});

// Resolves a chat file link. Explicit outside files include their own viewer URL.
export const resolveWikiFile = defineRpc({
  name: "wiki.resolve",
  input: z.object({ workspaceId: z.string().min(1), target: z.string() }),
  output: z.object({ path: z.string().nullable(), url: z.string().optional() }),
});
