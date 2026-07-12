/**
 * CGHC provider-key ingestion — hidden-prompt keystroke state machine (review LOW-1).
 *
 * Unit-tests the pure `applyHiddenKey` reducer WITHOUT a real TTY, proving that terminal
 * escape sequences (arrow keys, SS3, bracketed-paste wrappers) are DROPPED instead of
 * corrupting the hidden secret, while the real pasted text is preserved. Correctness matters
 * here because the input is invisible: a corrupted buffer would silently store a wrong key.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyHiddenKey,
  initialHiddenInputState,
  type HiddenKeySignal,
} from "../src/credential/hidden-prompt.js";

const ESC = String.fromCharCode(27);
const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BS = String.fromCharCode(8);

/** Feed a whole input string through the reducer; stop at the first submit/abort. */
function run(input: string): { buffer: string; signal: HiddenKeySignal } {
  let state = initialHiddenInputState;
  let signal: HiddenKeySignal = "continue";
  for (const ch of input) {
    const r = applyHiddenKey(state, ch);
    state = r.state;
    signal = r.signal;
    if (signal === "submit" || signal === "abort") break;
  }
  return { buffer: state.buffer, signal };
}

test("printable characters accumulate and Enter submits", () => {
  const { buffer, signal } = run("sk-deepseek-Abc123\r");
  assert.equal(buffer, "sk-deepseek-Abc123");
  assert.equal(signal, "submit");
});

test("Backspace edits the hidden buffer", () => {
  assert.equal(run(`abX${BS}c\n`).buffer, "abc");
});

test("Ctrl+C aborts; empty Ctrl+D aborts; Ctrl+D with content submits", () => {
  assert.equal(run(`abc${CTRL_C}`).signal, "abort");
  assert.equal(run(CTRL_D).signal, "abort");
  const withContent = run(`abc${CTRL_D}`);
  assert.equal(withContent.signal, "submit");
  assert.equal(withContent.buffer, "abc");
});

test("an arrow key (CSI ESC[D) is dropped, not injected into the secret", () => {
  const { buffer } = run(`ab${ESC}[Dc\r`);
  assert.equal(buffer, "abc", "the [D tail of the arrow sequence must not land in the buffer");
});

test("bracketed-paste wrappers are stripped but the pasted token is kept", () => {
  // A paste-enabled terminal wraps the paste in ESC[200~ … ESC[201~.
  const token = "sk-deepseek-DO-NOT-CORRUPT-9f8e7d";
  const { buffer, signal } = run(`${ESC}[200~${token}${ESC}[201~\r`);
  assert.equal(buffer, token);
  assert.equal(signal, "submit");
});

test("an SS3 sequence (ESC O F, e.g. End) and a lone ESC-letter are dropped", () => {
  assert.equal(run(`x${ESC}OFy\r`).buffer, "xy");
  assert.equal(run(`x${ESC}Zy\r`).buffer, "xy"); // ESC-Z two-char sequence: drop the Z
});

test("Unicode is accepted; other C0 control bytes are ignored", () => {
  assert.equal(run(`café${String.fromCharCode(1)}!\r`).buffer, "café!");
});
