/**
 * `BranchPermissionBindings` — session→preset registry (D1 fix). Pure in-memory unit tests, no
 * child/network/LLM.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createBranchPermissionBindings } from "../src/permission/index.js";

test("presetFor returns undefined for a session that was never bound", () => {
  const bindings = createBranchPermissionBindings();
  assert.equal(bindings.presetFor("sess-1"), undefined);
});

test("bind then presetFor returns the exact preset registered for that session", () => {
  const bindings = createBranchPermissionBindings();
  bindings.bind("sess-1", { edit: "deny" });
  assert.deepEqual(bindings.presetFor("sess-1"), { edit: "deny" });
});

test("release removes the binding; presetFor reverts to undefined", () => {
  const bindings = createBranchPermissionBindings();
  bindings.bind("sess-1", { edit: "deny" });
  bindings.release("sess-1");
  assert.equal(bindings.presetFor("sess-1"), undefined);
});

test("release is a no-op for a session that was never bound", () => {
  const bindings = createBranchPermissionBindings();
  assert.doesNotThrow(() => bindings.release("never-bound"));
});

test("bindings are per-session: binding one session never leaks to another", () => {
  const bindings = createBranchPermissionBindings();
  bindings.bind("branch-a", { edit: "deny" });
  assert.equal(bindings.presetFor("branch-b"), undefined);
});

test("a later bind for a recycled/reused session id overwrites the prior binding", () => {
  const bindings = createBranchPermissionBindings();
  bindings.bind("sess-1", { edit: "deny" });
  bindings.release("sess-1");
  bindings.bind("sess-1", {});
  assert.deepEqual(bindings.presetFor("sess-1"), {});
});
