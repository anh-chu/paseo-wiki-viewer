import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, hostname, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

// The plugin always targets the latest published release; there is deliberately
// no pinned version, so the installed viewer never silently diverges from it.
const WIKI_PACK = "wiki-viewer";
const NPM_LATEST_URL = "https://registry.npmjs.org/wiki-viewer/latest";
const MANAGED_ROOT = join(process.env.PASEO_HOME ?? join(homedir(), ".paseo"), "wiki-viewer");
const GRANT_COOKIE = "paseo_wiki_grant";
// Idle lifetime of a grant. Each proxied request extends it.
const GRANT_TTL_MS = 30 * 60 * 1000;

export interface ViewerConfig {
  publicUrl: string;
  port: number;
  viewerRoot: string;
}

interface Grant {
  root: string;
  expiresAt: number;
}

interface Viewer {
  child: ChildProcess;
  port: number;
}

function readInstalledVersion(root: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return typeof pkg.version === "string" && pkg.version !== "" ? pkg.version : null;
  } catch {
    return null;
  }
}

function installComplete(root: string): boolean {
  return existsSync(join(root, "bin", "wiki-viewer-lite.js")) && existsSync(join(root, ".next", "standalone", "server.js"));
}

// Installed release version, or null when no usable install exists.
function installedVersion(root: string): string | null {
  return installComplete(root) ? readInstalledVersion(root) : null;
}

function compareVersions(a: string, b: string): number {
  const na = a.split(".").map((part) => parseInt(part, 10) || 0);
  const nb = b.split(".").map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((na[i] ?? 0) > (nb[i] ?? 0)) return 1;
    if ((na[i] ?? 0) < (nb[i] ?? 0)) return -1;
  }
  return 0;
}

async function fetchLatestVersion(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(NPM_LATEST_URL, {
      headers: { accept: "application/json", "user-agent": "paseo-wiki-viewer" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`registry responded with ${response.status}`);
    const data = (await response.json()) as { version?: unknown };
    if (typeof data.version !== "string" || data.version === "") throw new Error("registry response has no version");
    return data.version;
  } finally {
    clearTimeout(timer);
  }
}

function run(argv: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${argv[0]} exited with ${code ?? signal ?? "failure"}`));
    });
  });
}

async function installViewer(root: string, version: string): Promise<void> {
  if (existsSync(join(root, ".git"))) {
    throw new Error(`refusing to install over the source checkout at ${root}; update it via git and build it there`);
  }
  mkdirSync(join(root, ".."), { recursive: true });
  const staging = `${root}.new-${process.pid}`;
  const backup = `${root}.old`;
  const temp = mkdtempSync(join(tmpdir(), "paseo-wiki-viewer-"));
  const pack = join(temp, "pack");
  mkdirSync(pack);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    await run(["npm", "pack", `${WIKI_PACK}@${version}`, "--pack-destination", pack], pack);
    const tgz = readdirSync(pack).find((entry) => entry.endsWith(".tgz"));
    if (!tgz) throw new Error("npm pack produced no wiki-viewer archive");
    await run(["tar", "-xzf", join(pack, tgz), "-C", staging, "--strip-components=1"], staging);
    if (!installComplete(staging) || readInstalledVersion(staging) !== version) {
      throw new Error(`wiki-viewer ${version} is missing its lite build`);
    }
    rmSync(backup, { recursive: true, force: true });
    if (existsSync(root)) renameSync(root, backup);
    renameSync(staging, root);
    rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (!existsSync(root) && existsSync(backup)) renameSync(backup, root);
    throw error;
  } finally {
    rmSync(staging, { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
  }
}

function startViewer(root: string): Promise<Viewer> {
  const bin = join(root, "bin", "wiki-viewer-lite.js");
  // stdin stays open: the launcher stops its server when stdin ends.
  const child = spawn(process.execPath, [bin], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  return new Promise((resolve, reject) => {
    let buffer = "";
    const fail = (error: Error) => {
      clearTimeout(timer);
      child.kill("SIGTERM");
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error("wiki viewer startup timed out")), 20_000);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(/WIKI_LITE_PORT=(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      // Keep draining the server's output so its pipe never fills.
      child.stdout?.off("data", onData);
      child.stdout?.resume();
      resolve({ child, port: Number(match[1]) });
    };
    child.stdout?.on("data", onData);
    child.on("error", fail);
    child.on("exit", (code, signal) => fail(new Error(`wiki viewer exited with ${code ?? signal}`)));
  });
}

function stopViewer(viewer: Viewer): Promise<void> {
  if (viewer.child.exitCode !== null || viewer.child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      viewer.child.kill("SIGKILL");
      resolve();
    }, 3000);
    viewer.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    viewer.child.kill("SIGTERM");
  });
}

// A started viewer can be killed or crash later. Any HTTP response means alive.
function viewerAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = request({ hostname: "127.0.0.1", port, path: "/api/wiki", method: "GET", timeout: 2000 }, (res) => {
      res.resume();
      resolve(true);
    });
    probe.on("error", () => resolve(false));
    probe.on("timeout", () => {
      probe.destroy();
      resolve(false);
    });
    probe.end();
  });
}

function grantFromRequest(req: IncomingMessage, url: URL): string {
  const fromQuery = url.searchParams.get("grant");
  if (fromQuery) return fromQuery;
  const match = (req.headers.cookie ?? "").match(new RegExp(`(?:^|;\\s*)${GRANT_COOKIE}=([^;]+)`));
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return "";
  }
}

function copyHeaders(source: IncomingMessage["headers"], port: number): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  // accept-encoding is left out so HTML arrives uncompressed and can carry the grant script.
  for (const name of ["accept", "accept-language", "cache-control", "content-type", "content-length", "if-none-match", "if-modified-since", "range", "user-agent"]) {
    const value = source[name];
    if (value !== undefined) headers[name] = value;
  }
  if (source.origin) headers.origin = `http://127.0.0.1:${port}`;
  headers.host = `127.0.0.1:${port}`;
  return headers;
}

// Inside a cross-site iframe (the Explorer panel) the browser drops the grant
// cookie, and the panel cannot reach into the frame. So every HTML page gets a
// script that adds the grant to the page's own same-origin requests.
function grantScript(grant: string): string {
  const source = `(() => {
  const grant = ${JSON.stringify(grant)};
  const withGrant = (value) => {
    try {
      const url = new URL(String(value), location.href);
      if (url.origin !== location.origin || url.searchParams.has("grant")) return value;
      url.searchParams.set("grant", grant);
      return url.toString();
    } catch { return value; }
  };
  // Browsers that block third-party storage throw on access inside the frame.
  for (const name of ["localStorage", "sessionStorage"]) {
    try { window[name].length; } catch {
      const data = new Map();
      const memory = {
        get length() { return data.size; },
        key: (i) => [...data.keys()][i] ?? null,
        getItem: (k) => (data.has(String(k)) ? data.get(String(k)) : null),
        setItem: (k, v) => { data.set(String(k), String(v)); },
        removeItem: (k) => { data.delete(String(k)); },
        clear: () => data.clear(),
      };
      try { Object.defineProperty(window, name, { value: memory, configurable: true }); } catch {}
    }
  }
  const fetch0 = window.fetch;
  window.fetch = (input, init) => {
    if (input instanceof Request) input = new Request(withGrant(input.url), input);
    else input = withGrant(input);
    return fetch0.call(window, input, init);
  };
  const open0 = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { return open0.call(this, method, withGrant(url), ...rest); };
  const winOpen0 = window.open;
  window.open = (url, ...rest) => winOpen0.call(window, url === undefined ? url : withGrant(url), ...rest);
  const click0 = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const href = this.getAttribute("href");
    if (href) this.setAttribute("href", withGrant(href));
    return click0.call(this);
  };
  const ATTRS = { IMG: "src", VIDEO: "src", AUDIO: "src", SOURCE: "src", IFRAME: "src", A: "href" };
  const patch = (el) => {
    const attr = ATTRS[el.tagName];
    if (!attr) return;
    const value = el.getAttribute(attr);
    if (!value || /^(#|data:|blob:|javascript:)/.test(value)) return;
    const next = withGrant(value);
    if (next !== value) el.setAttribute(attr, next);
  };
  const sweep = (root) => {
    if (root.nodeType !== 1) return;
    patch(root);
    for (const el of root.querySelectorAll("img[src],video[src],audio[src],source[src],iframe[src],a[href]")) patch(el);
  };
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") patch(record.target);
      else for (const node of record.addedNodes) sweep(node);
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "href"] });
})();`;
  return `<script>${source}</script>`;
}

function injectAfterHead(html: string, snippet: string): string {
  const match = /<head[^>]*>/i.exec(html);
  if (!match) return snippet + html;
  const end = match.index + match[0].length;
  return html.slice(0, end) + snippet + html.slice(end);
}

function proxy(req: IncomingMessage, res: ServerResponse, port: number, url: URL, root: string | null, grant: string) {
  const query = new URLSearchParams(url.search);
  query.delete("grant");
  // The grant decides the root; whatever the browser sent is replaced.
  if (root !== null) query.set("root", root);
  const search = query.toString();
  const upstream = request(
    { hostname: "127.0.0.1", port, method: req.method, path: `${url.pathname}${search ? `?${search}` : ""}`, headers: copyHeaders(req.headers, port) },
    (upstreamResponse) => {
      const headers = { ...upstreamResponse.headers };
      delete headers["set-cookie"];
      // The panel embeds the viewer from another origin.
      delete headers["x-frame-options"];
      if (url.searchParams.has("grant")) {
        headers["set-cookie"] = [`${GRANT_COOKIE}=${encodeURIComponent(grant)}; Path=/; HttpOnly; SameSite=Lax`];
      }
      const isHtml = String(headers["content-type"] ?? "").startsWith("text/html");
      if (!isHtml || grant === "" || headers["content-encoding"]) {
        res.writeHead(upstreamResponse.statusCode ?? 502, headers);
        upstreamResponse.pipe(res);
        return;
      }
      const chunks: Buffer[] = [];
      upstreamResponse.on("data", (chunk: Buffer) => chunks.push(chunk));
      upstreamResponse.on("end", () => {
        const body = injectAfterHead(Buffer.concat(chunks).toString("utf8"), grantScript(grant));
        delete headers["content-length"];
        delete headers["transfer-encoding"];
        headers["content-length"] = String(Buffer.byteLength(body));
        res.writeHead(upstreamResponse.statusCode ?? 502, headers);
        res.end(body);
      });
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("wiki viewer unavailable");
  });
  req.pipe(upstream);
}

// The viewer reads `_root/<base64url-dir>` asset paths as a replacement for
// ?root=, so a path sentinel may only name the grant's own root.
export function rootSentinelsMatch(pathname: string, root: string): boolean {
  let segments: string[];
  try {
    segments = pathname.split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    return false;
  }
  return segments.every((segment, i) => {
    if (segment !== "_root") return true;
    const encoded = segments[i + 1];
    if (!encoded) return false;
    return Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") === root;
  });
}

function text(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

export function createWikiService(readConfig: () => Promise<ViewerConfig>) {
  const grants = new Map<string, Grant>();
  let viewerPromise: Promise<Viewer> | undefined;
  let activeViewer: Viewer | null = null;
  let gate: { server: Server; port: number; requestedPort: number } | null = null;
  let updatePromise: Promise<{ updated: boolean; previous: string | null; version: string | null }> | undefined;

  const rootOf = (config: ViewerConfig) => (config.viewerRoot !== "" ? config.viewerRoot : MANAGED_ROOT);

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://wiki.internal");
    // Previewed pages embed files through the wiki's own capability token
    // (`/api/assets/_p/<token>/…`) from a sandboxed origin that carries no
    // cookie. The wiki validates that token itself, so it skips the grant gate.
    // Build assets hold no workspace data, and a cross-site frame sends them without the grant.
    // Native Worker/module loading bypasses the injected fetch wrapper too.
    const isPdfWorker = (req.method === "GET" || req.method === "HEAD") && url.pathname === "/pdfjs/pdf.worker.min.mjs";
    if (url.pathname.startsWith("/api/assets/_p/") || url.pathname.startsWith("/_next/static/") || isPdfWorker) {
      if (!activeViewer) return text(res, 503, "wiki viewer is not running");
      return proxy(req, res, activeViewer.port, url, null, "");
    }
    const grant = grantFromRequest(req, url);
    const entry = grant ? grants.get(grant) : undefined;
    if (!entry || entry.expiresAt <= Date.now()) {
      if (entry) grants.delete(grant);
      return text(res, 400, "wiki grant required");
    }
    let rootIsDir = false;
    try {
      rootIsDir = statSync(entry.root).isDirectory();
    } catch {}
    if (!rootIsDir) {
      grants.delete(grant);
      return text(res, 403, "wiki grant is no longer valid");
    }
    if (!rootSentinelsMatch(url.pathname, entry.root)) return text(res, 403, "outside the granted workspace");
    if (!activeViewer) return text(res, 503, "wiki viewer is not running");
    entry.expiresAt = Date.now() + GRANT_TTL_MS;
    // The lite viewer has no accounts and denies /api/auth/*, but its settings
    // component still polls for a session. Report the normal signed-out result
    // after checking the grant, without enabling any upstream auth routes.
    if (req.method === "GET" && url.pathname === "/api/auth/get-session") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end("null");
      return;
    }
    proxy(req, res, activeViewer.port, url, entry.root, grant);
  };

  async function ensureGate(requestedPort: number): Promise<number> {
    if (gate && gate.requestedPort === requestedPort) return gate.port;
    if (gate) await new Promise<void>((resolve) => gate!.server.close(() => resolve()));
    gate = null;
    const server = createServer(handle);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(requestedPort, "0.0.0.0", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    gate = { server, port, requestedPort };
    return port;
  }

  async function ensureViewer(root: string): Promise<Viewer> {
    // Installation is deliberate (the panel's Install button): opening the
    // wiki must not silently download tens of megabytes.
    if (!installedVersion(root)) {
      throw new Error(
        existsSync(join(root, ".git"))
          ? `wiki viewer source checkout at ${root} has no production build; build it there`
          : `wiki viewer is not installed at ${root}; install it from the Wiki Viewer panel`,
      );
    }
    if (!viewerPromise) viewerPromise = startViewer(root);
    try {
      let viewer = await viewerPromise;
      if (!(await viewerAlive(viewer.port))) {
        await stopViewer(viewer);
        viewerPromise = startViewer(root);
        viewer = await viewerPromise;
      }
      activeViewer = viewer;
      return viewer;
    } catch (error) {
      viewerPromise = undefined;
      throw error;
    }
  }

  async function shutdownViewer() {
    const pending = viewerPromise;
    viewerPromise = undefined;
    activeViewer = null;
    if (!pending) return;
    try {
      await stopViewer(await pending);
    } catch {}
  }

  async function prepare(directory: string) {
    if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error("workspace directory is unavailable");
    }
    const config = await readConfig();
    await ensureViewer(rootOf(config));
    const port = await ensureGate(config.port);
    const grant = randomUUID();
    const expiresAt = Date.now() + GRANT_TTL_MS;
    grants.set(grant, { root: directory, expiresAt });
    const base = (config.publicUrl !== "" ? config.publicUrl : `http://${hostname()}:${port}`).replace(/\/+$/, "");
    const params = new URLSearchParams({ grant, root: directory });
    return { url: `${base}/?${params}`, expiresAt };
  }

  async function describeVersion() {
    const config = await readConfig();
    const root = rootOf(config);
    const managed = config.viewerRoot === "";
    const installed = installedVersion(root);
    let latest: string | null = null;
    let latestError = "";
    try {
      latest = await fetchLatestVersion();
    } catch (error) {
      latestError = error instanceof Error ? error.message : "version check failed";
    }
    return {
      installed,
      latest,
      latestError,
      root,
      managed,
      checkout: !installed && existsSync(join(root, ".git")),
      updateAvailable: latest !== null && (installed === null || compareVersions(latest, installed) > 0),
    };
  }

  function update() {
    if (updatePromise) return updatePromise;
    updatePromise = (async () => {
      try {
        const config = await readConfig();
        if (config.viewerRoot !== "") throw new Error("a custom viewer root is set; update that install manually");
        const latest = await fetchLatestVersion();
        const current = installedVersion(MANAGED_ROOT);
        if (current === latest) return { updated: false, previous: current, version: current };
        await installViewer(MANAGED_ROOT, latest);
        await shutdownViewer();
        return { updated: true, previous: current, version: latest };
      } finally {
        updatePromise = undefined;
      }
    })();
    return updatePromise;
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [grant, entry] of grants) if (entry.expiresAt <= now) grants.delete(grant);
  }, 60_000);

  async function dispose() {
    clearInterval(sweep);
    grants.clear();
    if (gate) {
      gate.server.closeAllConnections();
      gate.server.close();
      gate = null;
    }
    await shutdownViewer();
  }

  return { prepare, describeVersion, update, dispose };
}

function insideRoot(root: string, real: string): string | null {
  const rel = relative(root, real);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

function listFiles(root: string, glob?: string): Promise<string[]> {
  const args = ["--files", "-g", "!node_modules", ...(glob ? ["-g", glob] : [])];
  return new Promise((resolve, reject) => {
    execFile("rg", args, { cwd: root, timeout: 30_000, maxBuffer: 256 << 20 }, (error, stdout) => {
      // rg exits 1 when nothing matches; that is an empty list, not a failure.
      if (error && !(typeof error.code === "number" && error.code === 1)) return reject(error);
      resolve(String(stdout).split("\n").filter((line) => line !== ""));
    });
  });
}

// Listing a large workspace takes seconds, so each one keeps a file list that
// is served while a newer one is built in the background.
const INDEX_TTL_MS = 60_000;
const MAX_INDEXES = 4;
const indexes = new Map<string, { at: number; files: string[] }>();
const building = new Map<string, Promise<{ at: number; files: string[] }>>();

function rebuildIndex(root: string) {
  let pending = building.get(root);
  if (!pending) {
    pending = listFiles(root)
      .then((files) => {
        const index = { at: Date.now(), files };
        indexes.delete(root);
        indexes.set(root, index);
        for (const key of indexes.keys()) if (indexes.size > MAX_INDEXES) indexes.delete(key);
        return index;
      })
      .finally(() => building.delete(root));
    building.set(root, pending);
  }
  return pending;
}

function fileIndex(root: string) {
  const cached = indexes.get(root);
  if (!cached) return rebuildIndex(root);
  if (Date.now() - cached.at > INDEX_TTL_MS) rebuildIndex(root).catch(() => {});
  return Promise.resolve(cached);
}

function newestFirst(root: string, files: string[]): string[] {
  return files
    .map((line) => {
      try {
        return { line, mtime: statSync(join(root, line)).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { line: string; mtime: number } => entry !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .map((entry) => entry.line);
}

// Workspace files whose path ends with `suffix`, newest first, like Paseo's own
// suffix lookup for bare names in chat. Needs ripgrep on the daemon's PATH.
async function findBySuffix(root: string, suffix: string): Promise<string[]> {
  const index = await fileIndex(root).catch(() => null);
  const matches = index ? index.files.filter((file) => file === suffix || file.endsWith(`/${suffix}`)) : [];
  if (matches.length > 0 || (index && Date.now() - index.at < 5000)) return newestFirst(root, matches);
  // The file may be newer than the index.
  const glob = `**/${suffix.replace(/[[\]{}*?!\\]/g, "\\$&")}`;
  return newestFirst(root, await listFiles(root, glob).catch(() => []));
}

// A chat link target ("src/a.ts:12", "/abs/b.md#L3", "file:///x", "panel.tsx")
// as a path relative to the workspace, when it names an existing file inside it.
function targetCandidates(target: string): string[] {
  let value = target.trim();
  if (value.startsWith("file://")) value = value.slice("file://".length);
  else if (value.startsWith("file:")) value = value.slice("file:".length);
  value = value.replace(/#.*$/, "");
  try {
    value = decodeURIComponent(value);
  } catch {}
  return [value, value.replace(/:\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/, ""), value.replace(/\(\d+(?:,\d+)?\)$/, "")].filter(
    (candidate, index, all) => candidate !== "" && all.indexOf(candidate) === index,
  );
}

export async function resolveWorkspaceFile(directory: string, target: string): Promise<string | null> {
  const candidates = targetCandidates(target);
  let root: string;
  try {
    root = realpathSync(directory);
  } catch {
    return null;
  }
  for (const candidate of candidates) {
    try {
      const real = realpathSync(isAbsolute(candidate) ? candidate : join(root, candidate));
      if (statSync(real).isFile()) return insideRoot(root, real);
    } catch {}
  }
  // Not a path from the workspace root: look it up by suffix, as Paseo does.
  for (const candidate of candidates) {
    if (isAbsolute(candidate) || candidate.split("/").includes("..")) continue;
    for (const match of await findBySuffix(root, candidate.replace(/^\.\//, ""))) {
      try {
        const rel = insideRoot(root, realpathSync(join(root, match)));
        if (rel) return rel;
      } catch {}
    }
  }
  return null;
}

// An explicit absolute chat link can name a file outside the chat workspace.
// Give that file its own directory scope; never reinterpret relative escapes
// or broaden an existing workspace grant to a common ancestor.
export function resolveExternalFile(directory: string, target: string): { directory: string; path: string } | null {
  for (const candidate of targetCandidates(target)) {
    if (!isAbsolute(candidate)) continue;
    try {
      const real = realpathSync(candidate);
      if (!statSync(real).isFile() || insideRoot(realpathSync(directory), real)) continue;
      return { directory: dirname(real), path: basename(real) };
    } catch {}
  }
  return null;
}
