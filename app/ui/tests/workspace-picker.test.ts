/**
 * Workspace picker tests (Slice 2 / CGHC-008).
 */

import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountWorkspacePicker } from "../src/workspace-picker.js";
import type { ServiceClient, WorkspaceGrantResult } from "../src/service-client.js";

const ROOT_A = "C:/fixture/workspace-a";
const ROOT_B = "C:/fixture/workspace-b";
const MISSING = "C:/fixture/missing";

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushAll(): Promise<void> {
  await flush();
  await flush();
  await flush();
}

type ClientMock = Pick<
  ServiceClient,
  "grantWorkspace" | "recentWorkspaces" | "setActiveWorkspace" | "getSettings"
>;

function mount(options: {
  readonly grant?: (rootPath: string) => Promise<WorkspaceGrantResult>;
  readonly pick?: () => Promise<{ canceled: boolean; rootPath?: string }>;
  readonly settings?: () => Promise<{ activeWorkspace: { rootPath: string } | null }>;
  readonly onActivated?: (rootPath: string) => void;
  readonly onDeactivated?: () => void;
}): {
  readonly container: HTMLElement;
  readonly calls: string[];
} {
  const container = document.createElement("div");
  document.body.append(container);
  const calls: string[] = [];
  const client: ClientMock = {
    getSettings: options.settings ?? (async () => ({ activeWorkspace: null })),
    grantWorkspace: async (rootPath) => {
      calls.push(`grant:${rootPath}`);
      return options.grant
        ? options.grant(rootPath)
        : {
            granted: true,
            grant: { id: "ws-1", rootPath, grantedAt: "2026-07-12T00:00:00.000Z" },
          };
    },
    recentWorkspaces: async () => [],
    setActiveWorkspace: async (rootPath) => {
      calls.push(`active:${rootPath}`);
      return {
        general: { theme: "system", verboseLogging: false, telemetryEnabled: false },
        providers: [],
        defaultModel: null,
        activeWorkspace: { rootPath },
      };
    },
  };
  mountWorkspacePicker(container, {
    bridge: {
      pickWorkspaceFolder: options.pick ?? (async () => ({ canceled: false, rootPath: ROOT_A })),
    },
    client,
    ...(options.onActivated !== undefined ? { onActivated: options.onActivated } : {}),
    ...(options.onDeactivated !== undefined ? { onDeactivated: options.onDeactivated } : {}),
  });
  return { container, calls };
}

test("native picker success persists activeWorkspace before showing active state", async () => {
  const h = mount({});
  await flushAll();
  h.container.querySelector<HTMLButtonElement>(".workspace-choose")!.click();
  await flushAll();

  assert.deepEqual(h.calls, [`grant:${ROOT_A}`, `active:${ROOT_A}`]);
  assert.match(h.container.querySelector(".workspace-status")!.textContent ?? "", /Đang hoạt động:/);
  assert.ok(h.container.querySelector(".workspace-picker")!.classList.contains("is-active"));
});

test("picker cancellation leaves workspace unchanged and shows no error", async () => {
  const h = mount({
    pick: async () => ({ canceled: true }),
    settings: async () => ({ activeWorkspace: { rootPath: ROOT_A } }),
    grant: async (rootPath) => ({
      granted: true,
      grant: { id: "ws-1", rootPath, grantedAt: "2026-07-12T00:00:00.000Z" },
    }),
  });
  await flushAll();
  assert.match(h.container.querySelector(".workspace-status")!.textContent ?? "", /Đang hoạt động:/);

  h.container.querySelector<HTMLButtonElement>(".workspace-choose")!.click();
  await flushAll();

  assert.deepEqual(h.calls, [`grant:${ROOT_A}`]);
  assert.match(h.container.querySelector(".workspace-status")!.textContent ?? "", /Đang hoạt động:/);
});

test("invalid directory is rejected and not persisted", async () => {
  const h = mount({
    grant: async () => ({
      granted: false,
      reason: "not_found",
      message: "Workspace does not exist.",
    }),
  });
  await flushAll();
  h.container.querySelector<HTMLButtonElement>(".workspace-choose")!.click();
  await flushAll();

  assert.deepEqual(h.calls, [`grant:${ROOT_A}`]);
  assert.match(h.container.querySelector(".workspace-status")!.textContent ?? "", /does not exist/);
});

test("failed activation preserves the previous valid workspace", async () => {
  const h = mount({
    settings: async () => ({ activeWorkspace: { rootPath: ROOT_A } }),
    grant: async (rootPath) => {
      if (rootPath === ROOT_A) {
        return {
          granted: true,
          grant: { id: "ws-a", rootPath, grantedAt: "2026-07-12T00:00:00.000Z" },
        };
      }
      return { granted: false, reason: "not_found", message: "Workspace does not exist." };
    },
    pick: async () => ({ canceled: false, rootPath: MISSING }),
  });
  await flushAll();
  assert.match(h.container.querySelector(".workspace-status")!.textContent ?? "", /Đang hoạt động:.*workspace-a/);

  h.container.querySelector<HTMLButtonElement>(".workspace-choose")!.click();
  await flushAll();

  assert.deepEqual(h.calls, [`grant:${ROOT_A}`, `grant:${MISSING}`]);
  assert.match(
    h.container.querySelector(".workspace-status")!.textContent ?? "",
    /Đang hoạt động:.*workspace-a.*does not exist/,
  );
});

test("restores and revalidates a persisted workspace on mount", async () => {
  const h = mount({
    settings: async () => ({ activeWorkspace: { rootPath: ROOT_B } }),
    grant: async (rootPath) => ({
      granted: true,
      grant: { id: "ws-b", rootPath, grantedAt: "2026-07-12T00:00:00.000Z" },
    }),
  });
  await flushAll();

  assert.deepEqual(h.calls, [`grant:${ROOT_B}`]);
  assert.equal(h.calls.includes(`active:${ROOT_B}`), false, "restore must not rewrite settings");
  assert.match(h.container.querySelector(".workspace-status")!.textContent ?? "", /workspace-b/);
});

test("missing restored workspace shows a recoverable state", async () => {
  const deactivated: string[] = [];
  const h = mount({
    settings: async () => ({ activeWorkspace: { rootPath: MISSING } }),
    grant: async () => ({
      granted: false,
      reason: "not_found",
      message: "Workspace does not exist.",
    }),
    onDeactivated: () => deactivated.push("x"),
  });
  await flushAll();

  assert.deepEqual(h.calls, [`grant:${MISSING}`]);
  assert.deepEqual(deactivated, ["x"]);
  assert.match(
    h.container.querySelector(".workspace-status")!.textContent ?? "",
    /không còn khả dụng.*does not exist/,
  );
});

test("activation callbacks fire only for a valid workspace", async () => {
  const events: string[] = [];
  const h = mount({
    onActivated: (p) => events.push(`on:${p}`),
    onDeactivated: () => events.push("off"),
  });
  await flushAll();
  assert.deepEqual(events, ["off"]);

  h.container.querySelector<HTMLButtonElement>(".workspace-choose")!.click();
  await flushAll();
  assert.deepEqual(events, ["off", `on:${ROOT_A}`]);
});

test("renderer workspace module does not call filesystem or ipc APIs directly", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../src/workspace-picker.ts", import.meta.url), "utf8"),
  );
  assert.equal(/import\s+.*['"]node:fs/.test(source), false);
  assert.equal(/from\s+['"]electron/.test(source), false);
  assert.equal(/\bipcRenderer\s*[.(]/.test(source), false);
  assert.equal(/\brequire\s*\(/.test(source), false);
});
