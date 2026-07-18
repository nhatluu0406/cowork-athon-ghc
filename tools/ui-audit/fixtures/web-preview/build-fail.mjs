/**
 * Deliberate error mode for the packaged Code Web Preview audit (the `serve` script).
 *
 * Emulates a build/typecheck failure: it prints a single deterministic `tsc`-style diagnostic to
 * stderr — the exact `file(line,col): error TSxxxx: message` shape the Problems parser
 * (app/ui/.../parse-problems.ts, TS_DIAGNOSTIC) recognises — then exits non-zero WITHOUT ever
 * binding a port. The runner therefore reports `failed`, and the "Vấn đề" tab shows one REAL parsed
 * problem (file + line:col + message) rather than a placeholder. Deterministic; no network; no writes.
 *
 * NOTE: this is test tooling, never shipped in the packaged app.
 */

// Keep this string EXACTLY parseable by TS_DIAGNOSTIC — src/app.tsx(12,7): error TS2322: <msg>.
process.stderr.write("cghc-web-preview-fixture: type-checking\n");
process.stderr.write(
  "src/app.tsx(12,7): error TS2322: Type 'number' is not assignable to type 'string'.\n",
);
process.exit(1);
