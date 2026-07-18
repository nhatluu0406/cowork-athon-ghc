/**
 * Desktop-app detector tests (Slice 2 discovery). Real temp workspaces, no process spawned.
 * Verifies the HONEST capability report: an Electron app with a run script is supported; a bare
 * Node/web project, a missing/ malformed manifest, or a project with no run script is unsupported.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectAppProject } from "../src/runtime-app/app-detector.js";

function workspace(pkg: unknown | string, extra?: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), "cghc-appdet-"));
  if (pkg !== undefined) {
    writeFileSync(join(root, "package.json"), typeof pkg === "string" ? pkg : JSON.stringify(pkg));
  }
  extra?.(root);
  return root;
}

test("electron dependency + run script → electron (supported)", async () => {
  const root = workspace({
    name: "app",
    devDependencies: { electron: "^30.0.0" },
    scripts: { start: "electron .", build: "tsc -p ." },
  });
  try {
    const info = await detectAppProject(root);
    assert.equal(info.kind, "electron");
    assert.equal(info.hasElectronDependency, true);
    assert.deepEqual([...info.runScripts], ["start"]);
    assert.deepEqual([...info.buildScripts], ["build"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("electron in dependencies (not just dev) is detected; multiple run scripts preserved in order", async () => {
  const root = workspace({
    name: "app",
    dependencies: { electron: "30" },
    scripts: { dev: "electron .", start: "electron .", app: "electron ." },
  });
  try {
    const info = await detectAppProject(root);
    assert.equal(info.kind, "electron");
    // Preference order is start, app, electron, dev, serve.
    assert.deepEqual([...info.runScripts], ["start", "app", "dev"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no electron dependency → unsupported (even with a start script)", async () => {
  const root = workspace({ name: "web", scripts: { start: "node server.js", dev: "vite" } });
  try {
    const info = await detectAppProject(root);
    assert.equal(info.kind, "unsupported");
    assert.equal(info.hasElectronDependency, false);
    assert.match(info.reason ?? "", /Electron/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("electron dependency but no run script → unsupported", async () => {
  const root = workspace({ name: "lib", devDependencies: { electron: "30" }, scripts: { build: "tsc" } });
  try {
    const info = await detectAppProject(root);
    assert.equal(info.kind, "unsupported");
    assert.equal(info.hasElectronDependency, true);
    assert.deepEqual([...info.buildScripts], ["build"]);
    assert.match(info.reason ?? "", /script chạy app/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed package.json → unsupported + malformed flag, never throws", async () => {
  const root = workspace('{ "name": "x", "scripts": { ');
  try {
    const info = await detectAppProject(root);
    assert.equal(info.kind, "unsupported");
    assert.equal(info.packageJsonMalformed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no package.json → unsupported", async () => {
  const root = workspace(undefined);
  try {
    const info = await detectAppProject(root);
    assert.equal(info.kind, "unsupported");
    assert.equal(info.hasPackageJson, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("package manager inferred from a lockfile", async () => {
  const root = workspace(
    { name: "app", devDependencies: { electron: "30" }, scripts: { start: "electron ." } },
    (r) => writeFileSync(join(r, "pnpm-lock.yaml"), "lockfileVersion: 9"),
  );
  try {
    const info = await detectAppProject(root);
    assert.equal(info.packageManager, "pnpm");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
