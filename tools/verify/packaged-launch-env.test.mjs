/**
 * Packaged launch env hygiene tests.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { packagedChildEnv } from "./packaged-launch-env.mjs";

test("packagedChildEnv removes ELECTRON_RUN_AS_NODE", () => {
  const env = packagedChildEnv({ COWORK_GHC_E2E: "1", ELECTRON_RUN_AS_NODE: "1" });
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.COWORK_GHC_E2E, "1");
});
