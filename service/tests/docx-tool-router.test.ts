/**
 * docx-tool-router — the agent-invocation wiring for the docx service (issue #25).
 *
 * Mirrors the MS365 pattern's security tests:
 *  - drift guard: DOCX_TOOL_NAME is exactly the tool name declared in DOCX_PLUGIN_SOURCE, so the
 *    router path and the plugin bridge cannot silently diverge (mirror ms365-plugin-file.test.ts).
 *  - a `deny` decision from a fake gate blocks the write (no file on disk) and returns a `denied`
 *    envelope — a decision object is not authorization; only `gate.proceed` behind a recorded Allow
 *    performs the mutation.
 *  - an `allow` decision creates a real .docx file inside the workspace.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import type { PermissionGate } from "../src/permission/index.js";
import type { RouteContext, RouteDefinition } from "../src/boundary/contract.js";
import {
  createDocxRouter,
  DOCX_TOOL_CALL_PATH,
  DOCX_TOOL_NAME,
  type DocxToolResult,
} from "../src/documents/docx-tool-router.js";
import { DOCX_PLUGIN_SOURCE } from "../src/runtime/docx-plugin-file.js";

async function tempWorkspace(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "cghc-docx-router-"));
  const root = join(base, "workspace");
  await mkdir(root, { recursive: true });
  return root;
}

/**
 * A minimal PermissionGate fake. `decision` fixes the outcome for every request:
 *  - "allow": `isAllowed` is true → `awaitGateDecision` resolves allowed; `proceed` runs `perform`.
 *  - "deny":  `isAllowed` is false and `pending()` is empty → `awaitGateDecision` resolves denied
 *             on the first poll, and `proceed` refuses to run `perform`.
 */
function fakeGate(decision: "allow" | "deny"): PermissionGate {
  const submitted = new Set<string>();
  const gate: Partial<PermissionGate> = {
    submit(request) {
      submitted.add(request.requestId);
    },
    isAllowed(requestId) {
      return decision === "allow" && submitted.has(requestId);
    },
    pending() {
      return [];
    },
    proceed(requestId, perform) {
      if (decision === "allow" && submitted.has(requestId)) {
        return { performed: true, result: perform() };
      }
      return { performed: false, reason: "not_allowed" };
    },
  };
  return gate as PermissionGate;
}

function callRoute(
  gate: PermissionGate,
  root: string,
  body: unknown,
): Promise<DocxToolResult> {
  const router = createDocxRouter({
    gate,
    workspaceRoot: () => root,
    now: () => "2026-01-01T00:00:00.000Z",
    wait: async () => {}, // instant poll seam — never wait out the real interval.
  });
  const route = router.routes.find((r) => r.path === DOCX_TOOL_CALL_PATH) as RouteDefinition;
  const ctx: RouteContext = {
    method: "POST",
    url: new URL(`http://127.0.0.1${DOCX_TOOL_CALL_PATH}`),
    params: {},
    body,
  };
  return Promise.resolve(route.handler(ctx)).then((res) => res.data as DocxToolResult);
}

const sampleBody = (path: string): unknown => ({
  name: DOCX_TOOL_NAME,
  args: {
    path,
    title: "Báo cáo",
    sections: [{ heading: { text: "Mục", level: 1 }, paragraphs: [{ text: "Nội dung." }] }],
  },
  sessionId: "sess-1",
  requestId: "req-1",
});

test("DOCX_TOOL_NAME matches the tool declared in DOCX_PLUGIN_SOURCE (drift guard)", () => {
  assert.ok(
    DOCX_PLUGIN_SOURCE.includes(`${DOCX_TOOL_NAME}:`),
    `plugin source must declare the ${DOCX_TOOL_NAME} tool`,
  );
});

test("plugin source reads endpoint+token ONLY from env — no literal secrets/URLs", () => {
  assert.ok(DOCX_PLUGIN_SOURCE.includes('process.env["CGHC_DOCX_TOOL_ENDPOINT"]'));
  assert.ok(DOCX_PLUGIN_SOURCE.includes('process.env["CGHC_DOCX_TOKEN"]'));
  assert.ok(!DOCX_PLUGIN_SOURCE.includes("127.0.0.1"));
});

test("plugin description steers the agent to create_docx instead of write", () => {
  assert.match(DOCX_PLUGIN_SOURCE, /never the plain 'write' tool/u);
});

test("a deny decision blocks the write (no file) and returns a denied envelope", async () => {
  const root = await tempWorkspace();
  try {
    const result = await callRoute(fakeGate("deny"), root, sampleBody("denied.docx"));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "denied");
    // Nothing was written — the gate blocked the mutation.
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(join(root, ".."), { recursive: true, force: true });
  }
});

test("an allow decision creates a real OOXML .docx", async () => {
  const root = await tempWorkspace();
  try {
    const result = await callRoute(fakeGate("allow"), root, sampleBody("out/report.docx"));
    assert.equal(result.ok, true, JSON.stringify(result));
    // The created file re-opens as a genuine OOXML Word package.
    const bytes = await readFile(join(root, "out", "report.docx"));
    const zip = await JSZip.loadAsync(bytes);
    assert.ok(zip.file("[Content_Types].xml"), "has [Content_Types].xml");
    assert.ok(zip.file("word/document.xml"), "has word/document.xml");
  } finally {
    await rm(join(root, ".."), { recursive: true, force: true });
  }
});

test("a missing path arg returns invalid_input without submitting a mutation", async () => {
  const root = await tempWorkspace();
  try {
    const result = await callRoute(fakeGate("allow"), root, {
      name: DOCX_TOOL_NAME,
      args: { sections: [{ paragraphs: [{ text: "x" }] }] },
      sessionId: "s",
      requestId: "r",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, "invalid_input");
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(join(root, ".."), { recursive: true, force: true });
  }
});
