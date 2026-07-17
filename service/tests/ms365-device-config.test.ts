import { test } from "node:test";
import assert from "node:assert/strict";
import { readMs365DeviceConfig } from "../src/ms365/index.js";

test("readMs365DeviceConfig returns null when client id is missing", () => {
  assert.equal(readMs365DeviceConfig({}), null);
  assert.equal(readMs365DeviceConfig({ CGHC_MS365_CLIENT_ID: "" }), null);
  assert.equal(readMs365DeviceConfig({ CGHC_MS365_CLIENT_ID: undefined }), null);
});

test("readMs365DeviceConfig defaults tenant to 'common' when only client id is set", () => {
  assert.deepEqual(
    readMs365DeviceConfig({ CGHC_MS365_CLIENT_ID: "client-abc" }),
    { clientId: "client-abc", tenant: "common" },
  );
});

test("readMs365DeviceConfig uses the provided tenant when both are set", () => {
  assert.deepEqual(
    readMs365DeviceConfig({
      CGHC_MS365_CLIENT_ID: "client-abc",
      CGHC_MS365_TENANT: "contoso.onmicrosoft.com",
    }),
    { clientId: "client-abc", tenant: "contoso.onmicrosoft.com" },
  );
});

test("readMs365DeviceConfig treats an empty tenant string as unset (falls back to 'common')", () => {
  assert.deepEqual(
    readMs365DeviceConfig({ CGHC_MS365_CLIENT_ID: "client-abc", CGHC_MS365_TENANT: "" }),
    { clientId: "client-abc", tenant: "common" },
  );
});
