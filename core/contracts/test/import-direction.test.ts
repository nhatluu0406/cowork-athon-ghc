import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { scanImportDirection } from "../boundary/import-direction.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const fixturesGood = join(here, "fixtures", "good");
const fixturesBad = join(here, "fixtures", "bad");

// (a) Passes on the current real tree. The planted-violation fixtures are excluded
// so that a genuine app/ui → app/shell import anywhere else would still be caught.
test("boundary lint passes on the current repository tree", async () => {
  const violations = await scanImportDirection(repoRoot, {
    ignore: ["/core/contracts/test/fixtures/"],
  });
  assert.deepEqual(
    violations,
    [],
    `expected no import-direction violations in the real tree, got: ${JSON.stringify(violations, null, 2)}`,
  );
});

// (a) Passes on the allowed-direction fixture (app/ui importing contracts + service).
test("boundary lint passes on the allowed-direction fixture", async () => {
  const violations = await scanImportDirection(fixturesGood);
  assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
});

// (b) FAILS on the planted forbidden-direction fixtures (app/ui importing app/shell +
// electron). This proves the rule actually catches the bad direction.
test("boundary lint catches the planted app/ui -> app/shell violations", async () => {
  const violations = await scanImportDirection(fixturesBad);

  assert.ok(
    violations.length >= 1,
    "expected the planted app/ui -> app/shell import to be flagged, but got none",
  );

  // Both the single-line and the multi-line fixture each flag the same three
  // forbidden specifiers → 6 violations across 2 files.
  const uniqueSpecifiers = [...new Set(violations.map((v) => v.specifier))].sort();
  assert.deepEqual(uniqueSpecifiers, [
    "../../../app/shell/supervisor.js",
    "@cowork-ghc/shell",
    "electron",
  ]);

  for (const v of violations) {
    assert.equal(v.rule, "ui-and-web-must-not-import-shell");
    assert.match(v.file, /app\/ui\/renderer(-multiline)?\.ts$/);
  }
});

// (b2) HIGH-2: prove the MULTI-LINE forbidden imports are caught (the previous
// single-line-only fixture would otherwise give false green).
test("boundary lint catches multi-line forbidden imports", async () => {
  const violations = await scanImportDirection(fixturesBad);
  const multiline = violations.filter((v) => /renderer-multiline\.ts$/.test(v.file));

  const specifiers = [...new Set(multiline.map((v) => v.specifier))].sort();
  assert.deepEqual(
    specifiers,
    ["../../../app/shell/supervisor.js", "@cowork-ghc/shell", "electron"],
    `multi-line fixture should flag the multi-line electron import, multi-line import() and require(); got ${JSON.stringify(specifiers)}`,
  );
});
