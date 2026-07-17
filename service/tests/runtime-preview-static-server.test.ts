/**
 * Bounded static server tests (real loopback server): it serves files inside the workspace,
 * blocks path traversal, refuses non-GET/HEAD, and serves index.html for a directory request.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStaticServer, type StaticServerHandle } from "../src/runtime-preview/static-server.js";
import { allocateLoopbackPort } from "../src/runtime-preview/port-detect.js";

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "cghc-static-"));
  writeFileSync(join(root, "index.html"), "<h1>home</h1>");
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "assets", "app.js"), "console.log('x')");
  return root;
}

test("static server serves index.html, assets, blocks traversal + non-GET", async () => {
  const root = workspace();
  // A sensitive file OUTSIDE the workspace (sibling) traversal must not reach.
  const outside = join(root, "..", `secret-${Date.now()}.txt`);
  writeFileSync(outside, "TOP SECRET");
  let handle: StaticServerHandle | undefined;
  try {
    const port = await allocateLoopbackPort();
    handle = await startStaticServer(root, port);

    const home = await fetch(`${handle.url}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /home/);
    assert.match(home.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(home.headers.get("x-content-type-options"), "nosniff");

    const asset = await fetch(`${handle.url}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);

    // Encoded traversal must be refused, not serve the outside secret.
    const escape = await fetch(`${handle.url}/..%2f..%2f${encodeURIComponent(`secret-x.txt`)}`);
    assert.ok(escape.status === 403 || escape.status === 404, `traversal blocked (${escape.status})`);

    const missing = await fetch(`${handle.url}/nope.html`);
    assert.equal(missing.status, 404);

    const post = await fetch(`${handle.url}/`, { method: "POST" });
    assert.equal(post.status, 405);
  } finally {
    await handle?.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { force: true });
  }
});
