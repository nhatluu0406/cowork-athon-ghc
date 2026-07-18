import "./setup-dom.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  CoworkShellBridge,
  RuntimePreviewProjectInfo,
  RuntimePreviewState,
} from "@cowork-ghc/contracts";
import { mountPreviewController } from "../src/ui-shell/code/preview-controller.js";
import type { ServiceClient } from "../src/service-client.js";

function runningState(url = "http://127.0.0.1:5050", kind: "static" | "dev-server" = "static"): RuntimePreviewState {
  return { status: "running", kind, url, port: 5050, command: kind === "dev-server" ? "npm run dev" : null, startedAt: "t", error: null, outputSeq: 0 };
}
const IDLE: RuntimePreviewState = { status: "idle", kind: null, url: null, port: null, command: null, startedAt: null, error: null, outputSeq: 0 };

interface FakeShell {
  bridge: CoworkShellBridge;
  loads: string[];
  bounds: { visible: boolean }[];
}
function fakeShell(): FakeShell {
  const loads: string[] = [];
  const bounds: { visible: boolean }[] = [];
  const bridge = {
    previewLoad: async (url: string) => {
      loads.push(url);
      return { ok: true };
    },
    previewSetBounds: async (b: { visible: boolean }) => {
      bounds.push(b);
    },
    previewHide: async () => undefined,
    previewReload: async () => undefined,
    previewClose: async () => undefined,
  } as unknown as CoworkShellBridge;
  return { bridge, loads, bounds };
}

function fakeClient(overrides: Partial<Record<keyof ServiceClient, unknown>>): ServiceClient {
  return {
    detectRuntimePreview: async () => ({ kind: "unsupported", hasStaticIndex: false, hasPackageJson: false, packageJsonMalformed: false, devScripts: [], packageManager: null, reason: "empty" } as RuntimePreviewProjectInfo),
    getRuntimePreviewOutput: async () => ({ state: IDLE, lines: [], truncated: false }),
    startStaticPreview: async () => runningState(),
    requestPreviewLaunch: async () => ({ requestId: "r1", command: "npm run dev", cwd: "C:\\ws" }),
    resolvePreviewLaunch: async () => runningState("http://127.0.0.1:5173", "dev-server"),
    stopRuntimePreview: async () => ({ ...IDLE, status: "stopped" }),
    restartRuntimePreview: async () => runningState("http://127.0.0.1:5173", "dev-server"),
    ...overrides,
  } as unknown as ServiceClient;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};

test("detect: unsupported shows an overlay and disables Start", async () => {
  const host = document.createElement("div");
  const shell = fakeShell();
  const controller = mountPreviewController(host, fakeClient({}), shell.bridge);
  controller.refreshDetect();
  await flush();
  assert.match(host.querySelector(".code-preview__overlay")?.textContent ?? "", /Chưa xem trước được|empty/);
  assert.equal(host.querySelector<HTMLButtonElement>(".code-preview__action")?.disabled, true);
  controller.dispose();
});

test("detect: dev-server with multiple scripts shows a script selector", async () => {
  const host = document.createElement("div");
  const shell = fakeShell();
  const client = fakeClient({
    detectRuntimePreview: async () =>
      ({ kind: "dev-server", hasStaticIndex: false, hasPackageJson: true, packageJsonMalformed: false, devScripts: ["dev", "start"], packageManager: "npm" }) as RuntimePreviewProjectInfo,
  });
  const controller = mountPreviewController(host, client, shell.bridge);
  controller.refreshDetect();
  await flush();
  const select = host.querySelector<HTMLSelectElement>(".code-preview__script");
  assert.ok(select && !select.hidden);
  assert.equal(select.options.length, 2);
  controller.dispose();
});

test("static Start reaches running and embeds the loopback URL", async () => {
  const host = document.createElement("div");
  const shell = fakeShell();
  const client = fakeClient({
    detectRuntimePreview: async () =>
      ({ kind: "static", hasStaticIndex: true, hasPackageJson: false, packageJsonMalformed: false, devScripts: [], packageManager: null }) as RuntimePreviewProjectInfo,
    getRuntimePreviewOutput: async () => ({ state: runningState(), lines: [], truncated: false }),
  });
  const controller = mountPreviewController(host, client, shell.bridge);
  controller.setActive(true);
  await flush();
  host.querySelector<HTMLButtonElement>(".code-preview__action")?.click(); // Start
  await flush();
  assert.ok(shell.loads.includes("http://127.0.0.1:5050"), "embedded the static loopback URL");
  controller.dispose();
});

test("dev-server Start shows an Allow/Deny confirm; Allow launches, Deny does not", async () => {
  // Deny path
  const host1 = document.createElement("div");
  const shell1 = fakeShell();
  let requested1 = 0;
  const denyClient = fakeClient({
    detectRuntimePreview: async () =>
      ({ kind: "dev-server", hasStaticIndex: false, hasPackageJson: true, packageJsonMalformed: false, devScripts: ["dev"], packageManager: "npm" }) as RuntimePreviewProjectInfo,
    requestPreviewLaunch: async () => {
      requested1 += 1;
      return { requestId: "r1", command: "npm run dev", cwd: "C:\\ws" };
    },
    resolvePreviewLaunch: async () => ({ ...IDLE, status: "stopped" }),
  });
  const controller1 = mountPreviewController(host1, denyClient, shell1.bridge);
  controller1.setActive(true);
  await flush();
  host1.querySelector<HTMLButtonElement>(".code-preview__action")?.click();
  await flush();
  const confirm = document.querySelector(".code-confirm");
  assert.ok(confirm, "launch confirm dialog appears for a dev-server command");
  document.querySelector<HTMLButtonElement>(".code-confirm__btn:not(.code-confirm__btn--primary)")?.click(); // Deny
  await flush();
  assert.equal(requested1, 1);
  assert.equal(shell1.loads.length, 0, "Deny never embeds a preview URL");
  controller1.dispose();

  // Allow path
  const host2 = document.createElement("div");
  const shell2 = fakeShell();
  const allowClient = fakeClient({
    detectRuntimePreview: async () =>
      ({ kind: "dev-server", hasStaticIndex: false, hasPackageJson: true, packageJsonMalformed: false, devScripts: ["dev"], packageManager: "npm" }) as RuntimePreviewProjectInfo,
    getRuntimePreviewOutput: async () => ({ state: runningState("http://127.0.0.1:5173", "dev-server"), lines: [], truncated: false }),
  });
  const controller2 = mountPreviewController(host2, allowClient, shell2.bridge);
  controller2.setActive(true);
  await flush();
  host2.querySelector<HTMLButtonElement>(".code-preview__action")?.click();
  await flush();
  document.querySelector<HTMLButtonElement>(".code-confirm__btn--primary")?.click(); // Allow
  await flush();
  assert.ok(shell2.loads.includes("http://127.0.0.1:5173"), "Allow launches and embeds the dev-server URL");
  controller2.dispose();
});

test("captured error output surfaces in the Vấn đề (Problems) tab with a localized label + count badge", async () => {
  const host = document.createElement("div");
  const shell = fakeShell();
  const client = fakeClient({
    detectRuntimePreview: async () =>
      ({ kind: "static", hasStaticIndex: true, hasPackageJson: false, packageJsonMalformed: false, devScripts: [], packageManager: null }) as RuntimePreviewProjectInfo,
    getRuntimePreviewOutput: async () => ({
      state: runningState(),
      lines: [
        { seq: 1, stream: "stdout" as const, text: "VITE v5  ready in 200 ms" },
        { seq: 2, stream: "stderr" as const, text: "src/app.ts(3,10): error TS2304: Cannot find name 'foo'." },
      ],
      truncated: false,
    }),
  });
  const controller = mountPreviewController(host, client, shell.bridge);
  controller.setActive(true);
  await flush();
  const tabs = host.querySelectorAll(".code-preview__drawer-tab");
  assert.equal(tabs[0]?.textContent, "Kết quả", "Output tab localized");
  assert.match(tabs[1]?.textContent ?? "", /^Vấn đề \(1\)$/, "Problems tab localized + count badge");
  const rows = host.querySelectorAll(".code-preview__problem");
  assert.equal(rows.length, 1, "one parsed problem row (dev-server chatter ignored)");
  assert.match(host.querySelector(".code-preview__problem-msg")?.textContent ?? "", /Cannot find name 'foo'/);
  assert.equal(host.querySelector(".code-preview__problem-loc")?.textContent, "src/app.ts:3:10");
  controller.dispose();
});

test("preview pane labels stay Vietnamese (commercial UI): kind + overlay title", async () => {
  const host = document.createElement("div");
  const shell = fakeShell();
  const controller = mountPreviewController(host, fakeClient({}), shell.bridge);
  controller.setActive(true);
  await flush();
  assert.equal(host.querySelector(".code-preview__kind")?.textContent, "Xem trước", "no English 'Preview' in the status bar");
  assert.doesNotMatch(host.querySelector(".code-preview__overlay")?.textContent ?? "", /Web preview/, "overlay title localized");
  controller.dispose();
});

test("re-detects capability each time Preview is re-activated (workspace/files may have changed)", async () => {
  const host = document.createElement("div");
  const shell = fakeShell();
  let kind: "unsupported" | "dev-server" = "unsupported";
  let detects = 0;
  const client = fakeClient({
    detectRuntimePreview: async () => {
      detects += 1;
      return kind === "dev-server"
        ? ({ kind: "dev-server", hasStaticIndex: false, hasPackageJson: true, packageJsonMalformed: false, devScripts: ["dev"], packageManager: "npm" } as RuntimePreviewProjectInfo)
        : ({ kind: "unsupported", hasStaticIndex: false, hasPackageJson: false, packageJsonMalformed: false, devScripts: [], packageManager: null, reason: "empty" } as RuntimePreviewProjectInfo);
    },
  });
  const controller = mountPreviewController(host, client, shell.bridge);
  controller.setActive(true);
  await flush();
  assert.equal(host.querySelector<HTMLButtonElement>(".code-preview__action")?.disabled, true, "Start disabled for unsupported");
  const first = detects;
  // Leave Preview, "change the workspace" to a dev-server project, re-enter Preview.
  controller.setActive(false);
  kind = "dev-server";
  controller.setActive(true);
  await flush();
  assert.ok(detects > first, "re-activation triggers a fresh detect");
  assert.equal(host.querySelector<HTMLButtonElement>(".code-preview__action")?.disabled, false, "Start enabled after re-detect finds a dev server");
  controller.dispose();
});

test("a re-run resets the output cursor so the new run's problems appear (service restarts seq at 0)", async () => {
  const host = document.createElement("div");
  const shell = fakeShell();
  let phase: "first" | "second" = "first";
  const client = fakeClient({
    detectRuntimePreview: async () =>
      ({ kind: "static", hasStaticIndex: true, hasPackageJson: false, packageJsonMalformed: false, devScripts: [], packageManager: null } as RuntimePreviewProjectInfo),
    startStaticPreview: async () => runningState(),
    restartRuntimePreview: async () => runningState(),
    // The service filters by `after` (its seq restarts at 0 on each run); the fake mirrors that.
    getRuntimePreviewOutput: async (after: number) => {
      const all =
        phase === "first"
          ? [{ seq: 1, stream: "stdout" as const, text: "serving http://127.0.0.1:5050" }]
          : [{ seq: 1, stream: "stderr" as const, text: "src/app.tsx(12,7): error TS2322: Type 'number' is not assignable to type 'string'." }];
      return { state: runningState(), lines: all.filter((l) => l.seq > after), truncated: false };
    },
  });
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1_400)); // > POLL_MS (1200)
  const controller = mountPreviewController(host, client, shell.bridge);
  try {
    controller.setActive(true);
    await flush();
    host.querySelector<HTMLButtonElement>(".code-preview__action")?.click(); // static Start (no confirm)
    await flush();
    assert.equal(host.querySelectorAll(".code-preview__problem").length, 0, "first run has no problems");

    // Second run: the service seq restarts at 0. Without a cursor reset the stale lastSeq would hide it.
    phase = "second";
    host.querySelector<HTMLButtonElement>('[aria-label="Khởi động lại"]')?.click(); // Restart
    await tick(); // let the running poller fetch the new run's output on its next tick
    await flush();
    assert.equal(host.querySelectorAll(".code-preview__problem").length, 1, "second run's diagnostic surfaces after the cursor reset");
  } finally {
    controller.dispose();
  }
});

test("inactive controller hides the embedded view (visible=false)", async () => {
  const host = document.createElement("div");
  const shell = fakeShell();
  const controller = mountPreviewController(host, fakeClient({}), shell.bridge);
  controller.setActive(false);
  await flush();
  assert.ok(shell.bounds.length > 0);
  assert.equal(shell.bounds[shell.bounds.length - 1]?.visible, false);
  controller.dispose();
});
