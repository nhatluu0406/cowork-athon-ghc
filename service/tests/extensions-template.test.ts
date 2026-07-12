/**
 * CGHC-026 RE4/RE5 — workflow template logic unit test.
 *
 * Proves: save a template, re-run it with inputs → the concrete run steps; re-run is repeatable;
 * an invalid template / missing input is a TYPED error (not a crash); an unexpected step failure
 * is captured as a diagnostic and quarantines the template without throwing.
 *
 * No live process, no network: pure resolution over an in-memory store.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTemplateRegistry,
  type TemplateStore,
  type WorkflowTemplate,
} from "../src/extensions/index.js";

/** A store that throws on save and/or get to prove FIX-4 isolation of the store seam. */
function throwingStore(opts: { onSave?: boolean; onGet?: boolean }): TemplateStore {
  const templates = new Map<string, WorkflowTemplate>();
  return {
    save: (t) => {
      if (opts.onSave) throw new Error("disk full on save");
      templates.set(t.id, t);
    },
    get: (id) => {
      if (opts.onGet) throw new Error("disk locked on get");
      return templates.get(id);
    },
    list: () => [...templates.values()],
    delete: (id) => templates.delete(id),
  };
}

const TEMPLATE: WorkflowTemplate = {
  id: "tpl-triage",
  name: "Triage Inbox",
  inputs: [
    { name: "folder", required: true },
    { name: "tone", required: false },
  ],
  steps: [
    { id: "s1", action: "list-files", params: { path: "${input.folder}" } },
    { id: "s2", action: "draft-reply", params: { tone: "${input.tone}", note: "static-note" } },
  ],
};

test("save then re-run produces the concrete steps with inputs resolved (RE4)", async () => {
  const reg = createTemplateRegistry();
  const saved = reg.save(TEMPLATE);
  assert.ok(saved.ok);

  const run = await reg.run("tpl-triage", { folder: "/inbox", tone: "formal" });
  assert.ok(run.ok);
  assert.deepEqual(run.value, [
    { stepId: "s1", action: "list-files", params: { path: "/inbox" } },
    { stepId: "s2", action: "draft-reply", params: { tone: "formal", note: "static-note" } },
  ]);
});

test("re-run is repeatable — same inputs yield identical steps", async () => {
  const reg = createTemplateRegistry();
  reg.save(TEMPLATE);
  const a = await reg.run("tpl-triage", { folder: "/inbox", tone: "formal" });
  const b = await reg.run("tpl-triage", { folder: "/inbox", tone: "formal" });
  assert.ok(a.ok && b.ok);
  assert.deepEqual(a.value, b.value);
});

test("a missing required input is a typed error, not a crash", async () => {
  const reg = createTemplateRegistry();
  reg.save(TEMPLATE);
  const run = await reg.run("tpl-triage", { tone: "formal" }); // no `folder`
  assert.equal(run.ok, false);
  assert.equal(run.ok === false && run.error.code, "invalid_input");
  assert.match(run.ok === false ? run.error.message : "", /folder/);
});

test("an unknown template id is a typed error", async () => {
  const reg = createTemplateRegistry();
  const run = await reg.run("nope", {});
  assert.equal(run.ok === false && run.error.code, "unknown_extension");
});

test("an invalid template (no steps / no name) is a typed error at save", () => {
  const reg = createTemplateRegistry();
  const noSteps = reg.save({ id: "x", name: "X", inputs: [], steps: [] });
  assert.equal(noSteps.ok === false && noSteps.error.code, "invalid_input");
  const noName = reg.save({ id: "y", name: "", inputs: [], steps: [{ id: "s", action: "a", params: {} }] });
  assert.equal(noName.ok === false && noName.error.code, "invalid_input");
});

test("an unexpected step failure is captured as a diagnostic + quarantine (RE5)", async () => {
  const reg = createTemplateRegistry();
  // A param referencing a required-but-absent input would normally be caught by the required
  // check; here we force a resolver throw via an UNDECLARED input reference that is not provided.
  reg.save({
    id: "tpl-bad",
    name: "Bad Template",
    inputs: [], // nothing declared required
    steps: [{ id: "s1", action: "do", params: { v: "${input.ghost}" } }],
  });

  const run = await reg.run("tpl-bad", {}); // `ghost` is neither declared nor provided
  assert.equal(run.ok, false);
  assert.equal(run.ok === false && run.error.code, "extension_failed");

  const diags = reg.diagnostics();
  assert.equal(diags.length, 1);
  assert.equal(diags[0]?.kind, "template");
  assert.equal(diags[0]?.name, "Bad Template");
  assert.match(diags[0]?.reason ?? "", /ghost/);

  // Quarantined: a re-run is skipped, not retried into a crash.
  const retry = await reg.run("tpl-bad", {});
  assert.equal(retry.ok === false && retry.error.code, "quarantined");
});

test("a throwing store on save is a typed error + diagnostic, no throw escapes (FIX-4)", () => {
  const reg = createTemplateRegistry({ store: throwingStore({ onSave: true }) });
  const saved = reg.save(TEMPLATE);
  assert.equal(saved.ok, false);
  assert.equal(saved.ok === false && saved.error.code, "extension_failed");
  const diags = reg.diagnostics();
  assert.equal(diags.length, 1);
  assert.equal(diags[0]?.kind, "template");
  assert.match(diags[0]?.reason ?? "", /disk full/);
});

test("a throwing store on run(load) is a typed error + diagnostic, no throw escapes (FIX-4)", async () => {
  const reg = createTemplateRegistry({ store: throwingStore({ onGet: true }) });
  const run = await reg.run("tpl-triage", { folder: "/x" });
  assert.equal(run.ok, false);
  assert.equal(run.ok === false && run.error.code, "extension_failed");
  const diags = reg.diagnostics();
  assert.equal(diags.length, 1);
  assert.match(diags[0]?.reason ?? "", /disk locked/);
});
