/**
 * CGHC-026 RE5 — failure-isolation test (the load-bearing safety property).
 *
 * Proves a broken extension:
 *  - surfaces a structured diagnostic (name + reason) with NO secret in the reason,
 *  - does NOT throw out of the registry (the operation returns a typed error), and
 *  - does NOT crash a session that uses it — a simulated session loop keeps running and keeps
 *    its own state after invoking the broken extension.
 *
 * No live process, no network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createExtensionRegistry,
  createExtensionState,
  runIsolated,
  runIsolatedSync,
  type McpAdapter,
  type SkillRunner,
} from "../src/extensions/index.js";

/** A runner whose thrown error embeds a secret-looking API key. */
const leakyRunner: SkillRunner = {
  run: () => {
    throw new Error("auth failed for key sk-ant-SECRETVALUE1234567890 at handler");
  },
};

/** An adapter that rejects connect with a secret-bearing message. */
const leakyAdapter: McpAdapter = {
  connect: () => Promise.reject(new Error("bearer token Bearer abcdef1234567890TOKEN rejected")),
  disconnect: () => Promise.resolve(),
  health: () => Promise.resolve({ status: "unavailable", detail: "n/a" }),
};

test("a broken skill surfaces a diagnostic with a secret-free reason and never throws", async () => {
  const ext = createExtensionRegistry({ skillRunner: leakyRunner });

  // exercise() resolves to a typed error — it does NOT throw, so no try/catch is needed.
  const run = await ext.skills.exercise("cowork.summarize", { text: "x" });
  assert.equal(run.ok, false);
  assert.equal(run.ok === false && run.error.code, "extension_failed");

  const diags = ext.diagnostics();
  assert.equal(diags.length, 1);
  assert.equal(diags[0]?.name, "Summarize Selection");
  // The secret value is redacted out of the reason.
  assert.ok(!/sk-ant-SECRETVALUE/.test(diags[0]?.reason ?? ""), "secret must not appear in the reason");
  assert.match(diags[0]?.reason ?? "", /\[redacted\]/);
});

test("a broken MCP connect keeps a secret out of the diagnostic reason", async () => {
  const ext = createExtensionRegistry({ mcpAdapter: leakyAdapter });
  await ext.mcp.add({ id: "srv-1", name: "Leaky", command: "x" });
  const enabled = await ext.mcp.enable("srv-1");
  assert.equal(enabled.ok, false);

  const diags = ext.mcp.diagnostics();
  assert.equal(diags.length, 1);
  assert.ok(!/abcdef1234567890TOKEN/.test(diags[0]?.reason ?? ""), "bearer token must be redacted");
  assert.match(diags[0]?.reason ?? "", /\[redacted\]/);
});

test("a broken extension does not crash a session that uses it (RE5)", async () => {
  const ext = createExtensionRegistry({ skillRunner: leakyRunner });

  // A minimal simulated session: it processes a queue of turns, one of which exercises a broken
  // skill. If the extension layer threw, the loop would abort and `completedTurns` would be short.
  const session = { id: "sess-1", completedTurns: 0, alive: true };
  const turns = ["greet", "use-broken-skill", "farewell"] as const;

  for (const turn of turns) {
    if (turn === "use-broken-skill") {
      const outcome = await ext.skills.exercise("cowork.summarize", { text: "x" });
      // The session inspects the typed outcome and CHOOSES to continue — no exception propagated.
      assert.equal(outcome.ok, false);
    }
    session.completedTurns += 1;
  }

  assert.equal(session.alive, true, "session survived the broken extension");
  assert.equal(session.completedTurns, 3, "every turn completed — the loop was never aborted");

  // The broken skill is quarantined; the rest of the layer is fully usable.
  assert.equal(ext.state.status("skill", "cowork.summarize"), "failed");
  assert.ok(ext.skills.list().length >= 1);
});

test("runIsolated never throws even when the injected redactor throws (FIX-3)", async () => {
  const state = createExtensionState();
  const throwingRedact = (): string => {
    throw new Error("the redactor itself blew up");
  };
  const outcome = await runIsolated<number>(
    { state, kind: "skill", id: "s1", name: "S1", redact: throwingRedact },
    () => {
      throw new Error("op failed");
    },
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.error.code, "extension_failed");
  // A throwing redactor falls back to the constant redacted reason — no escape, no raw text.
  assert.equal(outcome.ok === false && outcome.error.diagnostic?.reason, "[redacted]");
  assert.equal(state.status("skill", "s1"), "failed");
});

test("runIsolated never throws even when state.fail throws (FIX-3)", async () => {
  const base = createExtensionState();
  const hostileState = {
    ...base,
    fail: () => {
      throw new Error("state.fail blew up");
    },
  };
  const outcome = await runIsolated<number>(
    { state: hostileState, kind: "skill", id: "s1", name: "S1" },
    () => Promise.reject(new Error("op failed")),
  );
  // The load-bearing property holds: a typed error comes back, nothing propagates out.
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.error.code, "extension_failed");
  assert.equal(outcome.ok === false && outcome.error.diagnostic, undefined);
});

test("runIsolatedSync gives the same no-throw guarantee for a sync seam (FIX-3/FIX-4)", () => {
  const state = createExtensionState();
  const outcome = runIsolatedSync<number>(
    { state, kind: "template", id: "t1", name: "T1" },
    () => {
      throw new Error("sync seam failed");
    },
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.error.code, "extension_failed");
  assert.equal(state.status("template", "t1"), "failed");
});
