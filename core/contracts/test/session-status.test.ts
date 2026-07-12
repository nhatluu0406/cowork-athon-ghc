import assert from "node:assert/strict";
import { test } from "node:test";

import { TERMINAL_STATES } from "../src/ev.js";
import {
  SESSION_STATUSES,
  sessionStatusForTerminal,
  terminalStateToSessionStatus,
} from "../src/session.js";

// MEDIUM-1: every TerminalState maps to a valid SessionStatus, and the mapping is
// exhaustive (one entry per terminal state). The `satisfies Record<...>` in
// session.ts is the compile-time guard; this asserts the runtime shape too.
test("terminalStateToSessionStatus covers every TerminalState with a valid SessionStatus", () => {
  const validStatuses = new Set<string>(SESSION_STATUSES);

  assert.equal(
    Object.keys(terminalStateToSessionStatus).length,
    TERMINAL_STATES.length,
    "mapping must have exactly one entry per TerminalState",
  );

  for (const state of TERMINAL_STATES) {
    const status = sessionStatusForTerminal(state);
    assert.ok(
      validStatuses.has(status),
      `terminal state "${state}" mapped to "${status}", which is not a SessionStatus`,
    );
  }
});

// Guards the deliberate vocabulary alignment: the token drift (`error` vs `errored`)
// that MEDIUM-1 flagged must not come back.
test("SessionStatus vocabulary is aligned with TerminalState tokens", () => {
  for (const state of TERMINAL_STATES) {
    assert.ok(
      (SESSION_STATUSES as readonly string[]).includes(state),
      `SessionStatus is missing a counterpart for terminal state "${state}"`,
    );
  }
});
