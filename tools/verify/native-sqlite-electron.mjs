/**
 * Verify better-sqlite3 loads under Electron's Node ABI (not the host Node ABI).
 *
 * Host Node 22+ reports NODE_MODULE_VERSION 137; Electron 33 reports 130. Shipping the
 * host-built `.node` into the packaged app causes vault/service start failure and an empty
 * Settings → Nhà cung cấp panel.
 *
 * Usage (after `npm run rebuild:native:electron`):
 *   node tools/verify/native-sqlite-electron.mjs
 *
 * Exit 0 when Electron can `require("better-sqlite3")` and open an in-memory DB.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const require = createRequire(join(root, "package.json"));

let electronPath;
try {
  electronPath = require("electron");
} catch (error) {
  console.error("[native-sqlite-electron] electron is not installed:", error);
  process.exit(2);
}

const script = `
  const mod = process.versions.modules;
  if (mod !== "130") {
    console.error("unexpected Electron NODE_MODULE_VERSION:", mod, "(expected 130 for Electron 33)");
    process.exit(3);
  }
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  db.exec("create table t(x)");
  db.prepare("insert into t values (?)").run(1);
  const row = db.prepare("select x from t").get();
  db.close();
  if (!row || row.x !== 1) {
    console.error("in-memory sqlite round-trip failed");
    process.exit(4);
  }
  console.log("better-sqlite3 ok under Electron MODULE_VERSION", mod);
  process.exit(0);
`;

const result = spawnSync(electronPath, ["-e", script], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  windowsHide: true,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.error("[native-sqlite-electron] spawn failed:", result.error.message);
  process.exit(2);
}

process.exit(result.status === null ? 1 : result.status);
