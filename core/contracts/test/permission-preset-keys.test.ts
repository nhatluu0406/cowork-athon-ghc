/**
 * D1 fix, follow-up finding 2 — the canonical preset-key ↔ action-kind mapping shared by
 * validation (`dispatch.ts`) and enforcement (`service/src/files/tool-permission-proxy.ts`), so
 * the two can never drift apart. `ENFORCEABLE_PRESET_KEYS` is DERIVED from
 * `presetKeyForActionKind`, not hand-maintained separately.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ENFORCEABLE_PRESET_KEYS, presetKeyForActionKind } from "../src/permission-preset-keys.js";

test("presetKeyForActionKind maps every file-mutation kind to 'edit' and command_exec to 'bash'", () => {
  assert.equal(presetKeyForActionKind("file_create"), "edit");
  assert.equal(presetKeyForActionKind("file_edit"), "edit");
  assert.equal(presetKeyForActionKind("file_delete"), "edit");
  assert.equal(presetKeyForActionKind("file_move"), "edit");
  assert.equal(presetKeyForActionKind("command_exec"), "bash");
});

test("ENFORCEABLE_PRESET_KEYS is derived from presetKeyForActionKind — exactly {edit, bash}", () => {
  assert.deepEqual([...ENFORCEABLE_PRESET_KEYS].sort(), ["bash", "edit"]);
});
