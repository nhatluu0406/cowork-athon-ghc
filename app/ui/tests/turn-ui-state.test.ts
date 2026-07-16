/**
 * Focused tests for processing ownership + optimistic chat helpers.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isTerminalRuntimePhase,
  shouldShowProcessing,
} from "../src/turn-ui-state.js";

test("completed response hides processing", () => {
  assert.equal(
    shouldShowProcessing({
      activeConversationId: "c1",
      processingConversationId: "c1",
      runtimePhase: "completed",
    }),
    false,
  );
  assert.equal(isTerminalRuntimePhase("completed"), true);
});

test("New Chat never inherits old processing state", () => {
  assert.equal(
    shouldShowProcessing({
      activeConversationId: null,
      processingConversationId: "old",
      runtimePhase: "running",
    }),
    false,
  );
  assert.equal(
    shouldShowProcessing({
      activeConversationId: "new",
      processingConversationId: "old",
      runtimePhase: "running",
    }),
    false,
  );
});

test("switching conversation hides unrelated processing", () => {
  assert.equal(
    shouldShowProcessing({
      activeConversationId: "other",
      processingConversationId: "active-turn",
      runtimePhase: "running",
    }),
    false,
  );
  assert.equal(
    shouldShowProcessing({
      activeConversationId: "active-turn",
      processingConversationId: "active-turn",
      runtimePhase: "running",
    }),
    true,
  );
});

test("starting and cancelling still show processing for the owning conversation", () => {
  assert.equal(
    shouldShowProcessing({
      activeConversationId: "c1",
      processingConversationId: "c1",
      runtimePhase: "starting",
    }),
    true,
  );
  assert.equal(
    shouldShowProcessing({
      activeConversationId: "c1",
      processingConversationId: "c1",
      runtimePhase: "cancelling",
    }),
    true,
  );
});
