/**
 * Permission controller tests (CGHC-017 — the load-bearing UI contract).
 *
 * Driven synchronously against happy-dom with an INJECTED fake client (no socket): they prove
 * the UI faithfully issues decisions to the service. The most load-bearing assertions:
 *  - Deny maps to a REAL POST `{requestId, decision:"deny"}` (no UI-only handling); the actual
 *    server-side block is proven separately in the service test.
 *  - Allow posts `{decision:"allow", scope}` with the chosen/default scope.
 *  - An `already_resolved` / `unknown` outcome closes the modal with a TRUTHFUL note.
 *  - Empty pending shows NOTHING (honest idle — no fabricated activity).
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  DecidePermissionInput,
  PendingPermissionView,
  PermissionDecisionResponse,
} from "../src/service-client.js";
import { createPermissionController } from "../src/permission-controller.js";

const PENDING: PendingPermissionView = {
  requestId: "req-42",
  sessionId: "sess-1",
  approvalLevel: "standard",
  requestedAt: "2026-07-11T00:00:00.000Z",
  action: { kind: "file_create", description: "Tạo tệp README", targetPath: "C:/ws/README.md" },
};

interface Fake {
  readonly decisions: DecidePermissionInput[];
  setPending(list: readonly PendingPermissionView[]): void;
  setOutcome(outcome: PermissionDecisionResponse): void;
  /** Make the next `decidePermission` calls throw with this message (recovery/L2 tests). */
  failDecision(message: string): void;
  /** How many times `listPendingPermissions` was called (polling lifecycle/L3 tests). */
  listCount(): number;
  readonly client: {
    listPendingPermissions(): Promise<readonly PendingPermissionView[]>;
    decidePermission(input: DecidePermissionInput): Promise<PermissionDecisionResponse>;
  };
}

function makeFake(): Fake {
  const decisions: DecidePermissionInput[] = [];
  let pending: readonly PendingPermissionView[] = [];
  let listCalls = 0;
  let decisionError: Error | null = null;
  let outcome: PermissionDecisionResponse = {
    status: "resolved",
    decision: "deny",
    approvalLevel: "standard",
  };
  return {
    decisions,
    setPending: (list) => (pending = list),
    setOutcome: (o) => (outcome = o),
    failDecision: (message) => (decisionError = new Error(message)),
    listCount: () => listCalls,
    client: {
      listPendingPermissions: async () => {
        listCalls += 1;
        return pending;
      },
      decidePermission: async (input) => {
        decisions.push(input);
        if (decisionError) throw decisionError;
        return outcome;
      },
    },
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

function host(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

test("empty pending shows nothing (honest idle — no fabricated modal)", async () => {
  const fake = makeFake();
  const container = host();
  const ctrl = createPermissionController({ client: fake.client, container });
  await ctrl.refresh();
  assert.equal(container.querySelector(".permission-backdrop"), null, "no modal when nothing pending");
});

test("a pending request renders the head modal", async () => {
  const fake = makeFake();
  const container = host();
  fake.setPending([PENDING]);
  const ctrl = createPermissionController({ client: fake.client, container });
  await ctrl.refresh();
  assert.ok(container.querySelector(".permission-backdrop"), "modal shown for head pending");
  assert.equal(container.querySelector(".permission-action-kind")?.textContent, "Tạo tệp");
});

test("Deny maps to a real POST {requestId, decision:'deny'} — no UI-only handling", async () => {
  const fake = makeFake();
  const container = host();
  fake.setPending([PENDING]);
  fake.setOutcome({ status: "resolved", decision: "deny", approvalLevel: "standard" });
  const ctrl = createPermissionController({ client: fake.client, container });
  await ctrl.refresh();

  // After a deny the server has resolved it — the next poll returns empty.
  fake.setPending([]);
  container.querySelector<HTMLButtonElement>(".permission-deny")!.click();
  await flush();

  assert.deepEqual(fake.decisions, [{ requestId: "req-42", decision: "deny" }]);
  assert.equal(container.querySelector(".permission-backdrop"), null, "modal closed after deny");
});

test("Allow posts {decision:'allow', scope} with the default scope 'once'", async () => {
  const fake = makeFake();
  const container = host();
  fake.setPending([PENDING]);
  fake.setOutcome({ status: "resolved", decision: "allow", approvalLevel: "standard", scope: "once" });
  const ctrl = createPermissionController({ client: fake.client, container });
  await ctrl.refresh();

  fake.setPending([]);
  container.querySelector<HTMLButtonElement>(".permission-allow")!.click();
  await flush();

  assert.deepEqual(fake.decisions, [{ requestId: "req-42", decision: "allow", scope: "once" }]);
});

test("honesty — an 'already_resolved' outcome closes the modal with a truthful note (no fake success)", async () => {
  const fake = makeFake();
  const container = host();
  fake.setPending([PENDING]);
  fake.setOutcome({ status: "already_resolved", decision: "allow" });
  const ctrl = createPermissionController({ client: fake.client, container });
  await ctrl.refresh();

  fake.setPending([]);
  container.querySelector<HTMLButtonElement>(".permission-deny")!.click();
  await flush();

  assert.equal(container.querySelector(".permission-backdrop"), null, "modal closed");
  const note = container.querySelector<HTMLElement>(".permission-note");
  assert.equal(note?.hidden, false, "note visible");
  assert.match(note?.textContent ?? "", /đã được xử lý/i);
  // Truthful, not a fabricated "granted/completed".
  assert.doesNotMatch(note?.textContent ?? "", /hoàn thành|thành công|granted/i);
});

test("honesty — an 'unknown' outcome closes the modal with a truthful note", async () => {
  const fake = makeFake();
  const container = host();
  fake.setPending([PENDING]);
  fake.setOutcome({ status: "unknown", requestId: "req-42" });
  const ctrl = createPermissionController({ client: fake.client, container });
  await ctrl.refresh();

  fake.setPending([]);
  container.querySelector<HTMLButtonElement>(".permission-deny")!.click();
  await flush();

  assert.equal(container.querySelector(".permission-backdrop"), null, "modal closed");
  assert.match(
    container.querySelector(".permission-note")?.textContent ?? "",
    /không còn tồn tại/i,
  );
});

test("same head across refreshes keeps the SAME modal (de-duped, not re-created)", async () => {
  const fake = makeFake();
  const container = host();
  fake.setPending([PENDING]);
  const ctrl = createPermissionController({ client: fake.client, container });
  await ctrl.refresh();
  const first = container.querySelector(".permission-backdrop");
  await ctrl.refresh();
  const second = container.querySelector(".permission-backdrop");
  assert.equal(first, second, "modal element identity preserved across a same-head refresh");
});

test("no token/secret string is written into the DOM", async () => {
  const fake = makeFake();
  const container = host();
  fake.setPending([PENDING]);
  const ctrl = createPermissionController({ client: fake.client, container });
  await ctrl.refresh();
  assert.doesNotMatch(container.textContent ?? "", /Bearer|authorization|token|sk-/i);
});

test("honesty (L1) — a resolved decision that DIFFERS from the user's choice surfaces a truthful note", async () => {
  const fake = makeFake();
  const container = host();
  fake.setPending([PENDING]);
  // The user clicks Deny, but the gate records an ALLOW — a real mismatch, not what they chose.
  fake.setOutcome({ status: "resolved", decision: "allow", approvalLevel: "standard", scope: "once" });
  const ctrl = createPermissionController({ client: fake.client, container });
  await ctrl.refresh();

  fake.setPending([]); // gate resolved it server-side, so the next poll is empty
  container.querySelector<HTMLButtonElement>(".permission-deny")!.click();
  await flush();

  const note = container.querySelector<HTMLElement>(".permission-note");
  assert.equal(note?.hidden, false, "note visible on a decision mismatch");
  assert.match(note?.textContent ?? "", /khác với lựa chọn/i);
  // Truthful, not a fabricated success for the user's original choice.
  assert.doesNotMatch(note?.textContent ?? "", /hoàn thành|thành công|granted/i);
});

test("recovery (L2) — a failed decision POST keeps the request pending and shows the error in the re-opened modal", async () => {
  const fake = makeFake();
  const container = host();
  fake.setPending([PENDING]);
  const ctrl = createPermissionController({ client: fake.client, container });
  await ctrl.refresh();

  // The POST throws; the gate never recorded it, so the request STAYS pending (fail-safe: blocked).
  fake.failDecision("Mất kết nối tới dịch vụ cục bộ.");
  container.querySelector<HTMLButtonElement>(".permission-deny")!.click();
  await flush();

  assert.deepEqual(fake.decisions, [{ requestId: "req-42", decision: "deny" }], "a real deny POST was attempted");
  assert.ok(container.querySelector(".permission-backdrop"), "modal re-opened — action still blocked, request still pending");
  const note = container.querySelector<HTMLElement>(".permission-note");
  assert.equal(note?.hidden, false, "error note preserved after the modal re-opened");
  assert.match(note?.textContent ?? "", /Mất kết nối/i, "the user sees WHY it failed");
});

test("polling lifecycle (L3) — start() polls repeatedly; stop() halts further calls and closes the modal", async () => {
  const fake = makeFake();
  const container = host();
  let intervals = 0;
  let clears = 0;
  let tick: (() => void) | null = null;
  const timer = {
    setInterval: (handler: () => void) => {
      intervals += 1;
      tick = handler;
      return { id: intervals };
    },
    clearInterval: () => {
      clears += 1;
    },
  };
  const ctrl = createPermissionController({ client: fake.client, container, pollIntervalMs: 5, timer });

  ctrl.start();
  assert.equal(intervals, 1, "start() scheduled exactly one interval");
  ctrl.start(); // double-start guard
  assert.equal(intervals, 1, "a second start() does NOT create a second interval");
  await flush(); // initial refresh resolves

  const afterInit = fake.listCount();
  tick!();
  await flush();
  tick!();
  await flush();
  assert.ok(fake.listCount() >= afterInit + 2, "client is polled on each interval tick");

  // Open a modal, then prove stop() closes it and stops all further client calls.
  fake.setPending([PENDING]);
  tick!();
  await flush();
  assert.ok(container.querySelector(".permission-backdrop"), "modal open before stop()");

  const beforeStop = fake.listCount();
  ctrl.stop();
  assert.equal(clears, 1, "stop() cleared the interval");
  assert.equal(container.querySelector(".permission-backdrop"), null, "modal closed on stop()");
  assert.equal(fake.listCount(), beforeStop, "NO further client calls happen after stop()");
});

test("visibility gating (CGHC-025) — polling pauses while hidden and resumes + refreshes on return", async () => {
  const fake = makeFake();
  const container = host();
  let intervals = 0;
  let clears = 0;
  const timer = {
    setInterval: () => {
      intervals += 1;
      return { id: intervals };
    },
    clearInterval: () => {
      clears += 1;
    },
  };
  let hidden = false;
  let handler: (() => void) | null = null;
  const visibility = {
    isHidden: () => hidden,
    addVisibilityListener: (h: () => void) => {
      handler = h;
    },
    removeVisibilityListener: () => {
      handler = null;
    },
  };
  const ctrl = createPermissionController({
    client: fake.client,
    container,
    pollIntervalMs: 5,
    timer,
    visibility,
  });

  ctrl.start();
  await flush();
  assert.equal(intervals, 1, "start() (visible) scheduled one interval");
  const afterStart = fake.listCount();

  // Tab goes hidden: the interval is cleared and NO further polling happens.
  hidden = true;
  handler!();
  assert.equal(clears, 1, "hidden pauses the poll interval");
  const whileHidden = fake.listCount();
  assert.equal(whileHidden, afterStart, "no polling while hidden");

  // Tab returns to visible: it refreshes ONCE and re-arms the interval.
  hidden = false;
  handler!();
  await flush();
  assert.ok(fake.listCount() > whileHidden, "a refresh fires on return to visible");
  assert.equal(intervals, 2, "the poll interval is re-armed on return to visible");

  ctrl.stop();
  assert.equal(handler, null, "stop() removed the visibility listener");
});

test("visibility gating — start() while already hidden does NOT poll until visible", async () => {
  const fake = makeFake();
  const container = host();
  let intervals = 0;
  const timer = {
    setInterval: () => {
      intervals += 1;
      return { id: intervals };
    },
    clearInterval: () => {},
  };
  let hidden = true;
  let handler: (() => void) | null = null;
  const visibility = {
    isHidden: () => hidden,
    addVisibilityListener: (h: () => void) => {
      handler = h;
    },
    removeVisibilityListener: () => {
      handler = null;
    },
  };
  const ctrl = createPermissionController({ client: fake.client, container, timer, visibility });

  ctrl.start();
  await flush();
  assert.equal(intervals, 0, "no interval armed while starting hidden");
  assert.equal(fake.listCount(), 0, "no poll while hidden");

  hidden = false;
  handler!();
  await flush();
  assert.equal(intervals, 1, "becomes-visible arms the interval");
  assert.ok(fake.listCount() >= 1, "and refreshes once");
  ctrl.stop();
});

test("queue indicator (L5) — shows a truthful count for >1 pending; absent for a single request", async () => {
  const fake = makeFake();
  const container = host();
  const SECOND: PendingPermissionView = { ...PENDING, requestId: "req-43" };
  const THIRD: PendingPermissionView = { ...PENDING, requestId: "req-44" };
  fake.setPending([PENDING, SECOND, THIRD]);
  const ctrl = createPermissionController({ client: fake.client, container });
  await ctrl.refresh();

  const queue = container.querySelector<HTMLElement>(".permission-queue");
  assert.ok(queue, "queue indicator element exists");
  assert.equal(queue?.hidden, false, "queue indicator visible when N>1 pending");
  assert.match(queue?.textContent ?? "", /2/, "shows the 2 requests waiting behind the head");

  // The queue drains to a single (same-head) request → indicator updates and hides. No fake number.
  fake.setPending([PENDING]);
  await ctrl.refresh();
  const queueAfter = container.querySelector<HTMLElement>(".permission-queue");
  assert.equal(queueAfter?.hidden, true, "queue indicator hidden for a single pending request");
});
