import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RuntimeAppProjectInfo, RuntimeAppState } from "@cowork-ghc/contracts";
import { mountAppController } from "../src/ui-shell/code/app-controller.js";
import type { ServiceClient } from "../src/service-client.js";

const ELECTRON: RuntimeAppProjectInfo = {
  kind: "electron",
  hasPackageJson: true,
  packageJsonMalformed: false,
  hasElectronDependency: true,
  runScripts: ["start"],
  buildScripts: ["build"],
  packageManager: "npm",
};
const UNSUPPORTED: RuntimeAppProjectInfo = {
  kind: "unsupported",
  hasPackageJson: true,
  packageJsonMalformed: false,
  hasElectronDependency: false,
  runScripts: [],
  buildScripts: [],
  packageManager: null,
  reason: "Không phát hiện Electron",
};

const STOPPED: RuntimeAppState = {
  status: "stopped", kind: null, action: null, command: null, script: null, startedAt: null, error: null, exitCode: null, outputSeq: 0,
};
function runningState(): RuntimeAppState {
  return { status: "running", kind: "electron", action: "run", command: "npm run start", script: "start", startedAt: new Date().toISOString(), error: null, exitCode: null, outputSeq: 0 };
}

function fakeClient(overrides: Partial<Record<keyof ServiceClient, unknown>>): ServiceClient {
  return {
    detectRuntimeApp: async () => UNSUPPORTED,
    getRuntimeAppOutput: async () => ({ state: STOPPED, lines: [], truncated: false }),
    requestAppLaunch: async () => ({ requestId: "a1", action: "run", command: "npm run start", cwd: "C:\\ws" }),
    resolveAppLaunch: async () => runningState(),
    stopRuntimeApp: async () => ({ ...STOPPED, status: "stopped" }),
    restartRuntimeApp: async () => runningState(),
    ...overrides,
  } as unknown as ServiceClient;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};
const runBtn = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="Chạy ứng dụng"]');
const buildBtn = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[aria-label="Build ứng dụng"]');

test("unsupported project: overlay explains, Run disabled", async () => {
  const host = document.createElement("div");
  const controller = mountAppController(host, fakeClient({}));
  controller.refreshDetect();
  await flush();
  assert.match(host.querySelector(".code-preview__overlay")?.textContent ?? "", /Chưa chạy được ứng dụng|Electron/);
  assert.equal(runBtn(host)?.disabled, true);
  controller.dispose();
});

test("electron project: Run enabled, Build button shown", async () => {
  const host = document.createElement("div");
  const controller = mountAppController(host, fakeClient({ detectRuntimeApp: async () => ELECTRON }));
  controller.refreshDetect();
  await flush();
  assert.equal(runBtn(host)?.disabled, false);
  assert.equal(buildBtn(host)?.hidden, false);
  controller.dispose();
});

test("Run shows an Allow/Deny confirm; Deny never resolves to running, Allow launches", async () => {
  // Deny
  const host1 = document.createElement("div");
  let requested1 = 0;
  const denyClient = fakeClient({
    detectRuntimeApp: async () => ELECTRON,
    requestAppLaunch: async () => {
      requested1 += 1;
      return { requestId: "a1", action: "run", command: "npm run start", cwd: "C:\\ws" };
    },
    resolveAppLaunch: async (_id: string, decision: "allow" | "deny") =>
      decision === "allow" ? runningState() : { ...STOPPED, status: "stopped" },
  });
  const c1 = mountAppController(host1, denyClient);
  c1.setActive(true);
  await flush();
  runBtn(host1)?.click();
  await flush();
  assert.ok(document.querySelector(".code-confirm"), "confirm dialog appears for a Run command");
  document.querySelector<HTMLButtonElement>(".code-confirm__btn:not(.code-confirm__btn--primary)")?.click(); // Deny
  await flush();
  assert.equal(requested1, 1);
  assert.notEqual(host1.querySelector(".code-preview__status")?.textContent, "Đang chạy");
  c1.dispose();

  // Allow
  const host2 = document.createElement("div");
  let allowDecision: string | null = null;
  const allowClient = fakeClient({
    detectRuntimeApp: async () => ELECTRON,
    resolveAppLaunch: async (_id: string, decision: "allow" | "deny") => {
      allowDecision = decision;
      return runningState();
    },
    getRuntimeAppOutput: async () => ({ state: runningState(), lines: [], truncated: false }),
  });
  const c2 = mountAppController(host2, allowClient);
  c2.setActive(true);
  await flush();
  runBtn(host2)?.click();
  await flush();
  document.querySelector<HTMLButtonElement>(".code-confirm__btn--primary")?.click(); // Allow
  await flush();
  assert.equal(allowDecision, "allow", "Allow resolves the launch");
  assert.equal(host2.querySelector(".code-preview__status")?.textContent, "Đang chạy");
  c2.dispose();
});

test("Build shows a confirm labelled for build and resolves the build action", async () => {
  const host = document.createElement("div");
  let action: string | null = null;
  const client = fakeClient({
    detectRuntimeApp: async () => ELECTRON,
    requestAppLaunch: async (input: { action: string }) => {
      action = input.action;
      return { requestId: "b1", action: "build", command: "npm run build", cwd: "C:\\ws" };
    },
    resolveAppLaunch: async () => ({ ...STOPPED, status: "building", action: "build", command: "npm run build" }),
  });
  const controller = mountAppController(host, client);
  controller.setActive(true);
  await flush();
  buildBtn(host)?.click();
  await flush();
  assert.match(document.querySelector(".code-confirm__title")?.textContent ?? "", /Build/);
  document.querySelector<HTMLButtonElement>(".code-confirm__btn--primary")?.click();
  await flush();
  assert.equal(action, "build");
  controller.dispose();
});

test("captured app error output surfaces in the Vấn đề (Problems) tab with a localized label", async () => {
  const host = document.createElement("div");
  const controller = mountAppController(host, fakeClient({
    detectRuntimeApp: async () => ELECTRON,
    getRuntimeAppOutput: async () => ({
      state: runningState(),
      lines: [
        { seq: 1, stream: "system" as const, text: "▶ npm run start" },
        { seq: 2, stream: "stderr" as const, text: "Error: Cannot find module 'electron-store'" },
      ],
      truncated: false,
    }),
  }));
  controller.setActive(true);
  await flush();
  const tabs = host.querySelectorAll(".code-preview__drawer-tab");
  assert.equal(tabs[0]?.textContent, "Kết quả");
  assert.match(tabs[1]?.textContent ?? "", /^Vấn đề \(1\)$/);
  assert.match(host.querySelector(".code-preview__problem-msg")?.textContent ?? "", /Cannot find module 'electron-store'/);
  controller.dispose();
});

test("running state shows the running overlay and a Stop button", async () => {
  const host = document.createElement("div");
  const controller = mountAppController(host, fakeClient({
    detectRuntimeApp: async () => ELECTRON,
    getRuntimeAppOutput: async () => ({ state: runningState(), lines: [], truncated: false }),
  }));
  controller.setActive(true);
  await flush();
  assert.match(host.querySelector(".code-preview__overlay")?.textContent ?? "", /Đang chạy|cửa sổ riêng/);
  assert.equal(host.querySelector<HTMLButtonElement>('button[aria-label="Dừng ứng dụng"]')?.hidden, false);
  controller.dispose();
});
