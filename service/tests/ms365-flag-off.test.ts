import { test } from "node:test";
import assert from "node:assert/strict";
import { isMs365Enabled } from "../src/ms365/index.js";

test("MS365 is OFF by default (no env)", () => {
  assert.equal(isMs365Enabled({}), false);
});

test("MS365 is ON only for explicit '1'/'true'", () => {
  assert.equal(isMs365Enabled({ CGHC_MS365_ENABLED: "1" }), true);
  assert.equal(isMs365Enabled({ CGHC_MS365_ENABLED: "true" }), true);
  assert.equal(isMs365Enabled({ CGHC_MS365_ENABLED: "0" }), false);
});

test("MS365 flag is OFF for any other value or undefined", () => {
  assert.equal(isMs365Enabled({ CGHC_MS365_ENABLED: "false" }), false);
  assert.equal(isMs365Enabled({ CGHC_MS365_ENABLED: "" }), false);
  assert.equal(isMs365Enabled({ CGHC_MS365_ENABLED: undefined }), false);
  assert.equal(isMs365Enabled({ CGHC_MS365_ENABLED: "yes" }), false);
});
