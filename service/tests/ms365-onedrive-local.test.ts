/**
 * PHASE 3 — local OneDrive folder detection (fallback, not Graph/cloud).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLocalOneDrive } from "../src/ms365/onedrive-local.js";

const existsAll = (): boolean => true;
const existsNone = (): boolean => false;

test("prefers commercial > consumer > generic and returns the folder that exists", () => {
  assert.deepEqual(
    detectLocalOneDrive(
      { OneDriveCommercial: "C:\\Users\\a\\OneDrive - Contoso", OneDrive: "C:\\Users\\a\\OneDrive" },
      existsAll,
    ),
    { path: "C:\\Users\\a\\OneDrive - Contoso", kind: "commercial" },
  );
  assert.deepEqual(
    detectLocalOneDrive({ OneDriveConsumer: "C:\\Users\\a\\OneDrive" }, existsAll),
    { path: "C:\\Users\\a\\OneDrive", kind: "consumer" },
  );
  assert.deepEqual(
    detectLocalOneDrive({ OneDrive: "C:\\Users\\a\\OneDrive" }, existsAll),
    { path: "C:\\Users\\a\\OneDrive", kind: "generic" },
  );
});

test("returns null when no env var is set or the folder does not exist", () => {
  assert.equal(detectLocalOneDrive({}, existsAll), null);
  assert.equal(detectLocalOneDrive({ OneDrive: "" }, existsAll), null);
  assert.equal(detectLocalOneDrive({ OneDrive: "C:\\gone" }, existsNone), null);
});

test("skips a set-but-missing higher-priority var and falls through to an existing one", () => {
  const exists = (p: string): boolean => p === "C:\\Users\\a\\OneDrive";
  assert.deepEqual(
    detectLocalOneDrive(
      { OneDriveCommercial: "C:\\missing", OneDrive: "C:\\Users\\a\\OneDrive" },
      exists,
    ),
    { path: "C:\\Users\\a\\OneDrive", kind: "generic" },
  );
});
