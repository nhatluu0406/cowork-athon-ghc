/**
 * Pure-helper tests for the preview runner: launch policy (security), project detection,
 * bounded+redacted output buffer, and URL/port detection. No process is spawned.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertValidScriptName,
  assertValidPackageManager,
  buildDevServerCommand,
  buildPreviewEnv,
  InvalidLaunchError,
} from "../src/runtime-preview/launch-policy.js";
import { detectPreviewProject } from "../src/runtime-preview/project-detector.js";
import { createOutputBuffer, MAX_LINES, redactLine } from "../src/runtime-preview/output-buffer.js";
import { detectUrlInLine } from "../src/runtime-preview/port-detect.js";
import { createSecretScrubber } from "../src/diagnostics/secret-scrubber.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "cghc-preview-"));
}

// --- launch policy (security) ---

test("launch policy: rejects injection-shaped script names and unknown package managers", () => {
  for (const bad of ["dev && rm -rf x", "dev; echo hi", "../evil", "a b", 'x"y', "dev|cat"]) {
    assert.throws(() => assertValidScriptName(bad), InvalidLaunchError, bad);
  }
  assert.doesNotThrow(() => assertValidScriptName("dev"));
  assert.doesNotThrow(() => assertValidScriptName("build:web"));
  assert.throws(() => assertValidPackageManager("bun"), InvalidLaunchError);
  assert.throws(() => assertValidPackageManager("npm; echo"), InvalidLaunchError);
});

test("launch policy: dev command is cmd.exe with an argument array (no shell string)", () => {
  const cmd = buildDevServerCommand("npm", "dev", "C:\\Windows\\System32\\cmd.exe");
  assert.equal(cmd.command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual([...cmd.args], ["/d", "/s", "/c", "npm", "run", "dev"]);
  assert.equal(cmd.display, "npm run dev");
  // The script is a discrete arg, never concatenated into one shell string.
  assert.ok(!cmd.args.some((a) => a.includes(" ")));
});

test("launch policy: curated env drops secrets, keeps essentials + steering vars", () => {
  const env = buildPreviewEnv(
    {
      PATH: "C:\\bin",
      SystemRoot: "C:\\Windows",
      OPENAI_API_KEY: "sk-secret",
      CGHC_VAULT_KEY: "topsecret",
      OPENCODE_CONFIG_DIR: "C:\\x",
      RANDOM_TOKEN: "abc",
    },
    5173,
  );
  assert.equal(env["PATH"], "C:\\bin");
  assert.equal(env["SystemRoot"], "C:\\Windows");
  assert.equal(env["OPENAI_API_KEY"], undefined);
  assert.equal(env["CGHC_VAULT_KEY"], undefined);
  assert.equal(env["OPENCODE_CONFIG_DIR"], undefined);
  assert.equal(env["RANDOM_TOKEN"], undefined);
  assert.equal(env["BROWSER"], "none");
  assert.equal(env["PORT"], "5173");
  assert.equal(env["HOST"], "127.0.0.1");
});

// --- project detection ---

test("detect: dev-server project reports scripts + package manager from lockfile", async () => {
  const root = tempDir();
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { dev: "vite", build: "vite build", start: "node ." } }),
    );
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9");
    const info = await detectPreviewProject(root);
    assert.equal(info.kind, "dev-server");
    assert.deepEqual([...info.devScripts], ["dev", "start"]);
    assert.equal(info.packageManager, "pnpm");
    assert.equal(info.hasPackageJson, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detect: static index without scripts is a static project", async () => {
  const root = tempDir();
  try {
    writeFileSync(join(root, "index.html"), "<h1>hi</h1>");
    const info = await detectPreviewProject(root);
    assert.equal(info.kind, "static");
    assert.equal(info.hasStaticIndex, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detect: malformed package.json with no index is unsupported (honest, no crash)", async () => {
  const root = tempDir();
  try {
    writeFileSync(join(root, "package.json"), "{ not valid json");
    const info = await detectPreviewProject(root);
    assert.equal(info.kind, "unsupported");
    assert.equal(info.packageJsonMalformed, true);
    assert.ok(info.reason && info.reason.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detect: empty folder is unsupported", async () => {
  const root = tempDir();
  try {
    const info = await detectPreviewProject(root);
    assert.equal(info.kind, "unsupported");
    assert.equal(info.hasPackageJson, false);
    assert.equal(info.hasStaticIndex, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- output buffer (redaction + bounds) ---

test("output buffer: redacts registered secret values and heuristic secret shapes", () => {
  const scrubber = createSecretScrubber();
  scrubber.register("sk-supersecretvalue");
  const buf = createOutputBuffer(scrubber);
  buf.append("stdout", "using key sk-supersecretvalue now\n", "t");
  buf.append("stderr", "Authorization: Bearer abc.def.ghi\n", "t");
  buf.append("stdout", "db=postgres://user:p4ssw0rd@host/db\n", "t");
  buf.append("stdout", "GET /api?token=deadbeef&x=1\n", "t");
  const lines = buf.since(0).map((l) => l.text);
  assert.ok(lines[0]?.includes("[REDACTED]") && !lines[0]?.includes("sk-supersecret"));
  assert.ok(lines[1]?.includes("[REDACTED]") && !lines[1]?.includes("abc.def.ghi"));
  assert.ok(!lines[2]?.includes("p4ssw0rd"));
  assert.ok(!lines[3]?.includes("deadbeef"));
});

test("output buffer: bounded ring drops oldest and reports truncation; seq is monotonic", () => {
  const scrubber = createSecretScrubber();
  const buf = createOutputBuffer(scrubber);
  for (let i = 0; i < MAX_LINES + 50; i += 1) buf.append("stdout", `line ${i}\n`, "t");
  assert.equal(buf.totalSeq(), MAX_LINES + 50);
  assert.equal(buf.hasDropped(), true);
  const all = buf.since(0);
  assert.ok(all.length <= MAX_LINES);
  // Newest kept line is the last appended.
  assert.equal(all[all.length - 1]?.text, `line ${MAX_LINES + 49}`);
});

test("output buffer: coalesces partial chunks across newline boundaries", () => {
  const scrubber = createSecretScrubber();
  const buf = createOutputBuffer(scrubber);
  buf.append("stdout", "hel", "t");
  buf.append("stdout", "lo\nwor", "t");
  buf.append("stdout", "ld\n", "t");
  assert.deepEqual(buf.since(0).map((l) => l.text), ["hello", "world"]);
});

test("redactLine leaves ordinary text untouched", () => {
  const scrubber = createSecretScrubber();
  assert.equal(redactLine(scrubber, "VITE ready in 300 ms"), "VITE ready in 300 ms");
});

// --- URL detection ---

test("detectUrlInLine finds and normalises loopback URLs", () => {
  assert.deepEqual(detectUrlInLine("  Local:   http://localhost:5173/"), {
    url: "http://127.0.0.1:5173",
    port: 5173,
  });
  assert.deepEqual(detectUrlInLine("listening on http://127.0.0.1:3000"), {
    url: "http://127.0.0.1:3000",
    port: 3000,
  });
  assert.deepEqual(detectUrlInLine("On http://0.0.0.0:8080/"), {
    url: "http://127.0.0.1:8080",
    port: 8080,
  });
  assert.equal(detectUrlInLine("compiling modules..."), null);
  assert.equal(detectUrlInLine("see https://example.com/docs"), null);
});
