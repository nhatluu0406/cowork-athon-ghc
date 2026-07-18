/**
 * The Code "Vấn đề" (Problems) parser: real diagnostics out of captured run output, with honest
 * conservatism — clear compiler/bundler/lint errors are surfaced; ordinary dev-server chatter is not.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { RuntimePreviewOutputLine } from "@cowork-ghc/contracts";
import { parseProblems, problemLocation } from "../src/ui-shell/code/parse-problems.js";

function lines(...specs: Array<[RuntimePreviewOutputLine["stream"], string]>): RuntimePreviewOutputLine[] {
  return specs.map(([stream, text], i) => ({ seq: i + 1, stream, text }));
}

test("parses tsc diagnostics in both location formats", () => {
  const problems = parseProblems(
    lines(
      ["stdout", "src/app.ts(12,5): error TS2345: Argument of type 'string' is not assignable."],
      ["stdout", "src/util.ts:7:3 - error TS2531: Object is possibly 'null'."],
    ),
  );
  assert.equal(problems.length, 2);
  assert.deepEqual(problems[0], {
    severity: "error",
    file: "src/app.ts",
    line: 12,
    column: 5,
    message: "Argument of type 'string' is not assignable.",
  });
  assert.equal(problemLocation(problems[0]), "src/app.ts:12:5");
  assert.equal(problems[1].file, "src/util.ts");
  assert.equal(problems[1].line, 7);
});

test("parses esbuild / Vite [ERROR] banners and generic file:line:col errors", () => {
  const problems = parseProblems(
    lines(
      ["stderr", "[31m✘ [ERROR][0m Could not resolve \"./missing\""],
      ["stderr", "src/main.ts:3:8: error: Unexpected token"],
    ),
  );
  assert.equal(problems.length, 2);
  assert.equal(problems[0].severity, "error");
  assert.match(problems[0].message, /Could not resolve/);
  // ANSI colour codes are stripped before matching.
  assert.doesNotMatch(problems[0].message, //);
  assert.equal(problems[1].file, "src/main.ts");
  assert.equal(problems[1].column, 8);
});

test("parses ESLint rows and a bare Error: prefix", () => {
  const problems = parseProblems(
    lines(
      ["stdout", "  14:7   warning  'x' is assigned a value but never used  no-unused-vars"],
      ["stderr", "Error: Cannot find module 'express'"],
    ),
  );
  assert.equal(problems.length, 2);
  assert.equal(problems[0].severity, "warning");
  assert.equal(problems[0].line, 14);
  assert.equal(problems[0].column, 7);
  assert.match(problems[0].message, /never used/);
  assert.equal(problems[1].severity, "error");
  assert.match(problems[1].message, /Cannot find module 'express'/);
});

test("ignores ordinary dev-server chatter and system lines", () => {
  const problems = parseProblems(
    lines(
      ["system", "▶ npm run dev"],
      ["stdout", "VITE v5.0.0  ready in 312 ms"],
      ["stdout", "  ➜  Local:   http://127.0.0.1:5173/"],
      ["stdout", "watching for file changes..."],
      ["stderr", ""],
    ),
  );
  assert.deepEqual(problems, []);
});

test("de-duplicates identical diagnostics", () => {
  const same = "src/a.ts(1,1): error TS1005: ';' expected.";
  const problems = parseProblems(lines(["stdout", same], ["stdout", same], ["stdout", same]));
  assert.equal(problems.length, 1);
});

test("caps the number of surfaced problems", () => {
  const many: Array<[RuntimePreviewOutputLine["stream"], string]> = [];
  for (let i = 0; i < 500; i++) many.push(["stdout", `src/f${i}.ts(${i + 1},1): error TS1000: boom ${i}`]);
  const problems = parseProblems(lines(...many));
  assert.equal(problems.length, 200);
});
