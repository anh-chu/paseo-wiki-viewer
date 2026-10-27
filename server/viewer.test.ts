import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { resolveExternalFile, resolveWorkspaceFile, rootSentinelsMatch } from "./viewer";

const base = mkdtempSync(join(tmpdir(), "wiki-resolve-"));
const root = join(base, "workspace");
const outside = join(base, "outside");
mkdirSync(join(root, "client"), { recursive: true });
mkdirSync(join(root, "old", "client"), { recursive: true });
mkdirSync(outside);
writeFileSync(join(root, "OVERVIEW.md"), "# hi");
writeFileSync(join(root, "old", "client", "panel.tsx"), "old");
utimesSync(join(root, "old", "client", "panel.tsx"), new Date(2000, 0, 1), new Date(2000, 0, 1));
writeFileSync(join(root, "client", "panel.tsx"), "new");
writeFileSync(join(outside, "secret.txt"), "no");
symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
after(() => rmSync(base, { recursive: true, force: true }));

const cases: [string, string | null][] = [
  ["client/panel.tsx", "client/panel.tsx"],
  ["./client/panel.tsx:12", "client/panel.tsx"],
  ["client/panel.tsx:12:3-20", "client/panel.tsx"],
  ["client/panel.tsx#L5", "client/panel.tsx"],
  ["client/panel.tsx(10,2)", "client/panel.tsx"],
  [join(root, "OVERVIEW.md"), "OVERVIEW.md"],
  [`file://${join(root, "OVERVIEW.md")}`, "OVERVIEW.md"],
  // Bare names match by suffix, newest file first.
  ["panel.tsx", "client/panel.tsx"],
  ["panel.tsx:40", "client/panel.tsx"],
  ["/etc/passwd", null],
  ["../outside/secret.txt", null],
  ["escape.txt", null],
  ["client", null],
  ["missing-[x]*.md", null],
];

for (const [input, expected] of cases) {
  test(`resolves ${input}`, async () => {
    assert.equal(await resolveWorkspaceFile(root, input), expected);
  });
}

test("explicit outside files get their own directory scope", async () => {
  const target = join(outside, "secret.txt");
  assert.equal(await resolveWorkspaceFile(root, target), null);
  for (const link of [target, `${target}:12:3`, `file://${target}#L3`, `${target}(12,3)`]) {
    assert.deepEqual(resolveExternalFile(root, link), { directory: outside, path: "secret.txt" });
  }
});

test("outside-file resolution rejects relative escapes, directories, missing files and workspace files", () => {
  for (const target of ["../outside/secret.txt", "escape.txt", outside, join(outside, "missing.txt"), join(root, "OVERVIEW.md")]) {
    assert.equal(resolveExternalFile(root, target), null);
  }
});

// Mobile runs client bundles in Hermes, which rejects `class` syntax.
test("client and shared code has no class syntax", () => {
  const dirs = ["client", "shared"].map((dir) => join(import.meta.dirname, "..", dir));
  for (const dir of dirs) {
    for (const file of readdirSync(dir)) {
      assert.doesNotMatch(readFileSync(join(dir, file), "utf8"), /^\s*(export\s+)?class\s/m, `${dir}/${file}`);
    }
  }
});

const b64 = (dir: string) => Buffer.from(dir).toString("base64url");

test("asset root sentinels must name the granted root", () => {
  assert.equal(rootSentinelsMatch(`/api/assets/_root/${b64(root)}/OVERVIEW.md`, root), true);
  assert.equal(rootSentinelsMatch("/api/files/OVERVIEW.md", root), true);
  assert.equal(rootSentinelsMatch(`/api/assets/_root/${b64(outside)}/secret.txt`, root), false);
  assert.equal(rootSentinelsMatch(`/api/assets/%5Froot/${b64(outside)}/secret.txt`, root), false);
  assert.equal(rootSentinelsMatch(`/api/assets/_root/${b64(`${root}/../outside`)}/secret.txt`, root), false);
  assert.equal(rootSentinelsMatch("/api/assets/_root", root), false);
  assert.equal(rootSentinelsMatch("/api/assets/_root/%E0%A4%A", root), false);
});
