import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiff, diffStats } from "../src/ui-shell/code/parse-unified-diff.js";

const SAMPLE = [
  "--- a/src/x.ts",
  "+++ b/src/x.ts",
  "@@ -1,3 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " export {};",
].join("\n");

test("parses hunks with old/new line numbers", () => {
  const lines = parseUnifiedDiff(SAMPLE);
  assert.deepEqual(lines[0], { type: "ctx", oldN: 1, newN: 1, text: "const a = 1;" });
  assert.deepEqual(lines[1], { type: "del", oldN: 2, newN: null, text: "const b = 2;" });
  assert.deepEqual(lines[2], { type: "add", oldN: null, newN: 2, text: "const b = 3;" });
  assert.deepEqual(lines[3], { type: "add", oldN: null, newN: 3, text: "const c = 4;" });
  assert.deepEqual(lines[4], { type: "ctx", oldN: 3, newN: 4, text: "export {};" });
});

test("ignores headers, handles multiple hunks and no-newline marker", () => {
  const multi = ["@@ -10,1 +10,1 @@", "-x", "+y", "\\ No newline at end of file", "@@ -20,1 +21,1 @@", " z"].join("\n");
  const lines = parseUnifiedDiff(multi);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[2], { type: "ctx", oldN: 20, newN: 21, text: "z" });
});

test("strips trailing CR from CRLF input", () => {
  const lines = parseUnifiedDiff("@@ -1,1 +1,1 @@\r\n-old\r\n+new");
  assert.deepEqual(lines[0], { type: "del", oldN: 1, newN: null, text: "old" });
  assert.deepEqual(lines[1], { type: "add", oldN: null, newN: 1, text: "new" });
});

test("returns empty array for empty input", () => {
  assert.deepEqual(parseUnifiedDiff(""), []);
});

test("parses last content line without trailing newline", () => {
  const lines = parseUnifiedDiff("@@ -1,1 +1,2 @@\n const a = 1;\n+const b = 2;");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[1], { type: "add", oldN: null, newN: 2, text: "const b = 2;" });
});

test("diffStats counts adds/dels and tolerates undefined", () => {
  assert.deepEqual(diffStats(SAMPLE), { adds: 2, dels: 1 });
  assert.deepEqual(diffStats(undefined), { adds: 0, dels: 0 });
});
