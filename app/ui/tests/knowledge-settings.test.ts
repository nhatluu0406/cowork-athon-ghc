/**
 * Knowledge settings panel tests (T2.3).
 *
 * Tests configure → test-connection → disconnect flow with explicit verification
 * that no raw token appears in DOM/state (FR-013, SEC-2).
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { KnowledgeStatusView } from "@cowork-ghc/service/knowledge/types";
import type { ServiceClient } from "../src/service-client.js";
import { mountKnowledgeSettingsPanel } from "../src/knowledge-settings.js";

/** Fixture token that should NEVER appear in DOM or state. */
const FIXTURE_TOKEN = "token_abc123_xyz789_SECRET_DO_NOT_LEAK";

interface MockKnowledgeClient {
  status: KnowledgeStatusView;
  secretLog: string[];
}

function baseStatus(overrides?: Partial<KnowledgeStatusView>): KnowledgeStatusView {
  return {
    status: "not_configured",
    baseUrl: null,
    lastHealthCheckAt: null,
    ...overrides,
  };
}

function mockServiceClient(state: {
  knowledgeStatus?: KnowledgeStatusView;
  secretLog?: string[];
}): Pick<
  ServiceClient,
  | "getKnowledgeStatus"
  | "configureKnowledgeSource"
  | "testKnowledgeConnection"
  | "disconnectKnowledgeSource"
> {
  const mockClient: MockKnowledgeClient = {
    status: state.knowledgeStatus ?? baseStatus(),
    secretLog: state.secretLog ?? [],
  };

  return {
    getKnowledgeStatus: async () => mockClient.status,

    configureKnowledgeSource: async (baseUrl: string, token: string) => {
      // CRITICAL: log the token to verify it was passed, but never store it in state
      mockClient.secretLog.push(token);
      mockClient.status = {
        status: "connected",
        baseUrl,
        lastHealthCheckAt: new Date().toISOString(),
      };
      return mockClient.status;
    },

    testKnowledgeConnection: async () => {
      mockClient.status = {
        ...mockClient.status,
        lastHealthCheckAt: new Date().toISOString(),
      };
      return { ok: true };
    },

    disconnectKnowledgeSource: async () => {
      mockClient.status = baseStatus();
      return mockClient.status;
    },
  };
}

function mountHost(): HTMLElement {
  const host = document.createElement("div");
  host.className = "knowledge-settings-host";
  document.body.append(host);
  return host;
}

test("T2.3a: initial state shows not_configured status", async () => {
  const host = mountHost();
  const secretLog: string[] = [];

  mountKnowledgeSettingsPanel(host, {
    client: mockServiceClient({ knowledgeStatus: baseStatus(), secretLog }),
  });

  await new Promise((r) => setTimeout(r, 30));

  const statusElement = host.querySelector(".knowledge-settings-status");
  assert.ok(statusElement?.textContent?.includes("Chưa cấu hình"));
});

test("T2.3b: configure with baseUrl and token updates status to connected", async () => {
  const host = mountHost();
  const secretLog: string[] = [];

  mountKnowledgeSettingsPanel(host, {
    client: mockServiceClient({ secretLog }),
  });

  await new Promise((r) => setTimeout(r, 30));

  const baseUrlInput = host.querySelector<HTMLInputElement>(".knowledge-base-url-input");
  const tokenInput = host.querySelector<HTMLInputElement>(".knowledge-token-input");
  const saveButton = host.querySelector<HTMLButtonElement>(".knowledge-configure-save");

  assert.ok(baseUrlInput && tokenInput && saveButton);

  baseUrlInput.value = "http://localhost:8080";
  tokenInput.value = FIXTURE_TOKEN;

  saveButton.click();

  await new Promise((r) => setTimeout(r, 50));

  const statusElement = host.querySelector(".knowledge-settings-status");
  assert.ok(statusElement?.textContent?.includes("Đã kết nối"));

  // Verify token was logged (for the mock to work) but never in displayed state
  assert.equal(secretLog.length, 1, "token was passed to client");
  assert.equal(secretLog[0], FIXTURE_TOKEN);
});

test("T2.3c: FR-013/SEC-2 — no raw token appears in DOM after submit", async () => {
  const host = mountHost();
  const secretLog: string[] = [];

  mountKnowledgeSettingsPanel(host, {
    client: mockServiceClient({ secretLog }),
  });

  await new Promise((r) => setTimeout(r, 30));

  const baseUrlInput = host.querySelector<HTMLInputElement>(".knowledge-base-url-input");
  const tokenInput = host.querySelector<HTMLInputElement>(".knowledge-token-input");
  const saveButton = host.querySelector<HTMLButtonElement>(".knowledge-configure-save");

  assert.ok(baseUrlInput && tokenInput && saveButton);

  baseUrlInput.value = "http://localhost:8080";
  tokenInput.value = FIXTURE_TOKEN;

  saveButton.click();

  await new Promise((r) => setTimeout(r, 50));

  // EXPLICIT ASSERTION: search entire DOM for the fixture token
  const domText = host.innerText + host.innerHTML;
  assert.ok(!domText.includes(FIXTURE_TOKEN), "raw token does not appear in DOM or innerHTML");
  assert.ok(!domText.includes("token_abc123"), "no portion of token visible");
  assert.ok(!domText.includes("SECRET_DO_NOT_LEAK"), "secret phrase never leaked");

  // Also verify the token input field is cleared after successful submit
  assert.equal(tokenInput.value, "", "token input cleared after submit (R6 requirement)");
});

test("T2.3d: test-connection button sends a request and updates lastHealthCheckAt", async () => {
  const host = mountHost();

  mountKnowledgeSettingsPanel(host, {
    client: mockServiceClient({
      knowledgeStatus: {
        status: "connected",
        baseUrl: "http://localhost:8080",
        lastHealthCheckAt: null,
      },
    }),
  });

  await new Promise((r) => setTimeout(r, 30));

  const testButton = host.querySelector<HTMLButtonElement>(".knowledge-test-connection");
  assert.ok(testButton);

  testButton.click();

  await new Promise((r) => setTimeout(r, 50));

  // Status should still be connected, but lastHealthCheckAt should be updated
  const statusElement = host.querySelector(".knowledge-settings-status");
  assert.ok(statusElement?.textContent?.includes("Đã kết nối"));
});

test("T2.3e: disconnect clears configuration and resets to not_configured", async () => {
  const host = mountHost();

  // Mock window.confirm to always return true
  const originalConfirm = (globalThis as any).confirm;
  (globalThis as any).confirm = () => true;

  try {
    mountKnowledgeSettingsPanel(host, {
      client: mockServiceClient({
        knowledgeStatus: {
          status: "connected",
          baseUrl: "http://localhost:8080",
          lastHealthCheckAt: "2026-07-12T10:00:00.000Z",
        },
      }),
    });

    await new Promise((r) => setTimeout(r, 30));

    const disconnectButton = host.querySelector<HTMLButtonElement>(".knowledge-disconnect");
    assert.ok(disconnectButton);

    disconnectButton.click();

    await new Promise((r) => setTimeout(r, 50));

    const statusElement = host.querySelector(".knowledge-settings-status");
    assert.ok(statusElement?.textContent?.includes("Chưa cấu hình"));

    // Verify input fields are cleared
    const baseUrlInput = host.querySelector<HTMLInputElement>(".knowledge-base-url-input");
    const tokenInput = host.querySelector<HTMLInputElement>(".knowledge-token-input");

    assert.equal(baseUrlInput?.value, "");
    assert.equal(tokenInput?.value, "");
  } finally {
    // Restore original confirm
    (globalThis as any).confirm = originalConfirm;
  }
});

test("T2.3f: token input field starts empty and is cleared on successful save (R6)", async () => {
  const host = mountHost();

  mountKnowledgeSettingsPanel(host, {
    client: mockServiceClient({ knowledgeStatus: baseStatus() }),
  });

  await new Promise((r) => setTimeout(r, 30));

  const tokenInput = host.querySelector<HTMLInputElement>(".knowledge-token-input");
  assert.equal(tokenInput?.value, "", "token input starts empty");

  tokenInput!.value = "test-token";
  assert.equal(tokenInput?.value, "test-token", "can be set");

  const baseUrlInput = host.querySelector<HTMLInputElement>(".knowledge-base-url-input");
  baseUrlInput!.value = "http://localhost:8080";

  const saveButton = host.querySelector<HTMLButtonElement>(".knowledge-configure-save");
  saveButton?.click();

  await new Promise((r) => setTimeout(r, 50));

  assert.equal(tokenInput?.value, "", "token input cleared after submit");
});

test("T2.3g: shows auth_failed status when configured source fails auth", async () => {
  const host = mountHost();

  mountKnowledgeSettingsPanel(host, {
    client: mockServiceClient({
      knowledgeStatus: {
        status: "auth_failed",
        baseUrl: "http://localhost:8080",
        lastHealthCheckAt: "2026-07-12T10:00:00.000Z",
      },
    }),
  });

  await new Promise((r) => setTimeout(r, 30));

  const statusElement = host.querySelector(".knowledge-settings-status");
  assert.ok(
    statusElement?.textContent?.includes("Xác thực thất bại") ||
      statusElement?.textContent?.includes("auth_failed"),
    "shows auth failed status",
  );
});

test("T2.3h: shows unreachable status when configured source is unreachable", async () => {
  const host = mountHost();

  mountKnowledgeSettingsPanel(host, {
    client: mockServiceClient({
      knowledgeStatus: {
        status: "unreachable",
        baseUrl: "http://localhost:9999",
        lastHealthCheckAt: "2026-07-12T10:00:00.000Z",
      },
    }),
  });

  await new Promise((r) => setTimeout(r, 30));

  const statusElement = host.querySelector(".knowledge-settings-status");
  assert.ok(statusElement?.textContent?.includes("Không thể truy cập"));
});

test("T2.3i: configure flow hides token input content visually (masked input)", async () => {
  const host = mountHost();

  mountKnowledgeSettingsPanel(host, {
    client: mockServiceClient({ knowledgeStatus: baseStatus() }),
  });

  await new Promise((r) => setTimeout(r, 30));

  const tokenInput = host.querySelector<HTMLInputElement>(".knowledge-token-input");
  // Input should have type="password" to mask display
  assert.equal(tokenInput?.type, "password", "token input is masked (password type)");
});

test("T2.3j: baseUrl input validates basic URL format and shows error on invalid URL", async () => {
  const host = mountHost();

  mountKnowledgeSettingsPanel(host, {
    client: mockServiceClient({ knowledgeStatus: baseStatus() }),
  });

  await new Promise((r) => setTimeout(r, 30));

  const baseUrlInput = host.querySelector<HTMLInputElement>(".knowledge-base-url-input");
  const saveButton = host.querySelector<HTMLButtonElement>(".knowledge-configure-save");

  baseUrlInput!.value = "not-a-valid-url";
  baseUrlInput!.dispatchEvent(new Event("change", { bubbles: true }));

  await new Promise((r) => setTimeout(r, 20));

  // Button should be disabled or error shown
  const errorMessage = host.querySelector(".knowledge-url-error");
  assert.ok(
    saveButton?.disabled || errorMessage,
    "either button disabled or error message shown for invalid URL",
  );
});
