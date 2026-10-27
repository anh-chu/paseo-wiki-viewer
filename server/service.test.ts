import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createWikiService } from "./viewer";

test("lite session checks require a grant and workspace grants stay isolated", async () => {
  const base = mkdtempSync(join(tmpdir(), "wiki-service-"));
  const viewerRoot = join(base, "viewer");
  const first = join(base, "first");
  const second = join(base, "second");
  for (const dir of [join(viewerRoot, "bin"), join(viewerRoot, ".next", "standalone"), first, second]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(viewerRoot, "package.json"), JSON.stringify({ version: "1.0.0" }));
  writeFileSync(join(viewerRoot, ".next", "standalone", "server.js"), "");
  // A small upstream that rejects auth routes, as the published lite viewer does.
  writeFileSync(join(viewerRoot, "bin", "wiki-viewer-lite.js"), `
    const { createServer } = require("node:http");
    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://wiki.test");
      if (url.pathname.startsWith("/api/auth/")) { res.writeHead(404); res.end(); return; }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ root: url.searchParams.get("root") }));
    });
    server.listen(0, "127.0.0.1", () => console.log("WIKI_LITE_PORT=" + server.address().port));
    process.stdin.resume();
  `);
  const service = createWikiService(async () => ({ publicUrl: "", port: 0, viewerRoot }));
  try {
    const prepared = await service.prepare(first);
    const firstUrl = new URL(prepared.url);
    firstUrl.hostname = "127.0.0.1";
    const workerUrl = new URL("/pdfjs/pdf.worker.min.mjs", firstUrl);
    const worker = await fetch(workerUrl);
    assert.equal(worker.status, 200, "embedded PDF workers load without cookies or a grant query");
    assert.deepEqual(await worker.json(), { root: null });
    assert.equal((await fetch(workerUrl, { method: "HEAD" })).status, 200);
    assert.equal((await fetch(workerUrl, { method: "POST" })).status, 400);
    for (const path of ["/api/assets/private.pdf", "/api/wiki", "/pdfjs/private.pdf"]) {
      assert.equal((await fetch(new URL(path, firstUrl))).status, 400);
    }
    const sessionUrl = new URL("/api/auth/get-session", firstUrl);
    assert.equal((await fetch(sessionUrl)).status, 400);
    sessionUrl.searchParams.set("grant", "invalid");
    assert.equal((await fetch(sessionUrl)).status, 400);
    sessionUrl.searchParams.set("grant", firstUrl.searchParams.get("grant")!);
    const session = await fetch(sessionUrl);
    assert.equal(session.status, 200);
    assert.equal(session.headers.get("cache-control"), "no-store");
    assert.equal(await session.json(), null);
    assert.equal((await fetch(sessionUrl, { method: "POST" })).status, 404);
    sessionUrl.pathname = "/api/auth/sign-up/email";
    assert.equal((await fetch(sessionUrl)).status, 404);

    const secondUrl = new URL((await service.prepare(second)).url);
    secondUrl.hostname = "127.0.0.1";
    firstUrl.pathname = secondUrl.pathname = "/api/wiki";
    // Browser-supplied roots cannot change the workspace attached to a grant.
    firstUrl.searchParams.set("root", second);
    secondUrl.searchParams.set("root", first);
    assert.deepEqual(await (await fetch(firstUrl)).json(), { root: first });
    assert.deepEqual(await (await fetch(secondUrl)).json(), { root: second });
  } finally {
    await service.dispose();
    rmSync(base, { recursive: true, force: true });
  }
});
