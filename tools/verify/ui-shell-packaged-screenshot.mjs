/**
 * Packaged UI shell smoke helper: launch, wait for 1a Airy shell, capture screenshot, stop.
 * Used by the Windows lifecycle chore; does not call a live provider.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packagedChildEnv } from "./packaged-launch-env.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const EXE = join(REPO, "dist-app", "win-unpacked", "Cowork GHC.exe");
const OUT = join(REPO, "reports", "cowork-ghc-ui-shell-packaged.png");
const CDP_PORT = 19226;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countProcesses(image) {
  try {
    const out = execSync(`tasklist /FI "IMAGENAME eq ${image}" /NH`, { encoding: "utf8" });
    return out.split(/\r?\n/u).filter((line) => line.includes(image)).length;
  } catch {
    return 0;
  }
}

async function cdpCall(method, params = {}) {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const target = list.find((t) => typeof t.url === "string" && t.url.startsWith("app://cowork"));
  if (!target?.webSocketDebuggerUrl) throw new Error("Renderer CDP target not found.");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("CDP websocket failed")));
  });
  const id = 1;
  const result = await new Promise((resolve, reject) => {
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      if (msg.error) reject(new Error(msg.error.message ?? "CDP call failed"));
      else resolve(msg.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.close();
  return result;
}

async function waitForShell(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ready = await cdpCall("Runtime.evaluate", {
        expression: `(() => {
          const shell = document.querySelector('.app-shell');
          const sidebar = document.querySelector('.sidebar');
          const chat = document.querySelector('.chat-area');
          const panel = document.querySelector('.right-panel');
          const status = document.querySelector('.topbar__status')?.textContent ?? '';
          return !!(shell && sidebar && chat && panel) && /local service/i.test(status);
        })()`,
        returnByValue: true,
      });
      if (ready.result?.value === true) return;
    } catch {
      // renderer not ready yet
    }
    await sleep(400);
  }
  throw new Error("Timed out waiting for packaged 1a Airy shell.");
}

async function main() {
  if (!existsSync(EXE)) throw new Error(`Packaged exe missing: ${EXE}`);
  mkdirSync(dirname(OUT), { recursive: true });

  const proc = spawn(EXE, [], {
    env: packagedChildEnv({ COWORK_GHC_REMOTE_DEBUG_PORT: String(CDP_PORT) }),
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    await waitForShell();
    const shot = await cdpCall("Page.captureScreenshot", { format: "png", fromSurface: true });
    if (!shot?.data) throw new Error("CDP screenshot returned no image data.");
    writeFileSync(OUT, Buffer.from(shot.data, "base64"));
    console.log(`screenshot: ${OUT}`);
  } finally {
    if (proc.exitCode === null) proc.kill();
    await sleep(2000);
    try {
      execSync(`taskkill /F /IM "Cowork GHC.exe" /T`, { stdio: "ignore" });
    } catch {
      // already stopped
    }
    try {
      execSync(`taskkill /F /IM "opencode.exe" /T`, { stdio: "ignore" });
    } catch {
      // already stopped
    }
    await sleep(1000);
    const coworkLeft = countProcesses("Cowork GHC.exe");
    const opencodeLeft = countProcesses("opencode.exe");
    if (coworkLeft > 0 || opencodeLeft > 0) {
      throw new Error(`Orphan processes remain: Cowork GHC.exe=${coworkLeft}, opencode.exe=${opencodeLeft}`);
    }
    console.log("process cleanup: OK");
  }
}

await main();
