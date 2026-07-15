/**
 * Probe one OpenCode binary against the Wave 2 server-contract matrix (no product pin change).
 * Usage: node tools/verify/opencode-server-probe.mjs <binPath> <label>
 */

import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = process.argv[2];
const label = process.argv[3] ?? bin;
if (!bin) {
  console.error("usage: node opencode-server-probe.mjs <binPath> <label>");
  process.exit(2);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealth(base, timeoutMs = 20_000) {
  const started = Date.now();
  let lastErr = "";
  while (Date.now() - started < timeoutMs) {
    try {
      const t0 = Date.now();
      const res = await fetch(new URL("/global/health", base));
      const ms = Date.now() - t0;
      if (res.ok) {
        const body = await res.json();
        return { ok: true, ms, body };
      }
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await sleep(150);
  }
  return { ok: false, ms: null, body: null, error: lastErr };
}

async function main() {
  const port = await freePort();
  const root = mkdtempSync(join(tmpdir(), "oc-probe-"));
  const cwd = join(root, "ws");
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "README.md"), "probe\n");

  const hostname = "127.0.0.1";
  const base = `http://${hostname}:${port}`;
  const args = ["serve", "--hostname", hostname, "--port", String(port)];
  const child = spawn(bin, args, {
    cwd,
    env: {
      ...process.env,
      OPENCODE_DISABLE_TELEMETRY: "1",
      XDG_DATA_HOME: join(root, "xdg-data"),
      XDG_CONFIG_HOME: join(root, "xdg-config"),
      XDG_STATE_HOME: join(root, "xdg-state"),
      XDG_CACHE_HOME: join(root, "xdg-cache"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += d.toString("utf8");
  });

  const results = {
    label,
    bin,
    port,
    contracts: {},
    healthLatencyMs: null,
    reportedVersion: null,
    passed: false,
  };

  try {
    const health = await waitHealth(base);
    results.contracts.health = health.ok;
    results.healthLatencyMs = health.ms;
    results.reportedVersion =
      health.body && typeof health.body.version === "string" ? health.body.version : null;

    if (!health.ok) {
      results.contracts.error = health.error ?? "health_failed";
      results.stderrTail = stderr.slice(-800);
      console.log(JSON.stringify(results, null, 2));
      process.exitCode = 1;
      return;
    }

    // Session create
    {
      const res = await fetch(new URL("/session", base), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ title: "compat-probe" }),
      });
      const text = await res.text();
      let id = null;
      try {
        const j = JSON.parse(text);
        id = j?.id ?? j?.data?.id ?? null;
      } catch {
        // ignore
      }
      results.contracts.session_create = res.ok && typeof id === "string";
      results.sessionId = id;

      if (typeof id === "string") {
        const get = await fetch(new URL(`/session/${encodeURIComponent(id)}`, base), {
          headers: { accept: "application/json" },
        });
        results.contracts.session_get = get.ok;

        const list = await fetch(new URL("/session", base), {
          headers: { accept: "application/json" },
        });
        results.contracts.session_list = list.ok;

        // Message route must exist (accept JSON; may 4xx without model — still a contract surface)
        const msg = await fetch(new URL(`/session/${encodeURIComponent(id)}/message`, base), {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ parts: [{ type: "text", text: "ping" }] }),
        });
        results.contracts.session_message_route =
          msg.status !== 404 && msg.status !== 405;
        results.session_message_status = msg.status;

        const abort = await fetch(new URL(`/session/${encodeURIComponent(id)}/abort`, base), {
          method: "POST",
          headers: { accept: "application/json" },
        });
        results.contracts.session_abort = abort.status !== 404 && abort.status !== 405;
      }
    }

    // Permission reply route shape (404 for unknown id is OK — proves route exists)
    {
      const res = await fetch(new URL("/permission/compat-probe/reply", base), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ reply: "reject" }),
      });
      results.contracts.permission_reply_route = res.status !== 405;
      results.permission_reply_status = res.status;
    }

    // /event accepts SSE (short peek)
    {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 800);
      try {
        const res = await fetch(new URL("/event", base), {
          headers: { accept: "text/event-stream" },
          signal: controller.signal,
        });
        results.contracts.event_sse =
          res.ok &&
          typeof res.headers.get("content-type") === "string" &&
          res.headers.get("content-type").includes("text/event-stream");
        controller.abort();
      } catch (e) {
        // Abort after headers may throw; count as pass if we already marked ok
        if (results.contracts.event_sse !== true) {
          results.contracts.event_sse = false;
          results.event_error = e instanceof Error ? e.message : String(e);
        }
      } finally {
        clearTimeout(timer);
      }
    }

    const required = [
      "health",
      "session_create",
      "session_get",
      "session_list",
      "session_message_route",
      "session_abort",
      "permission_reply_route",
      "event_sse",
    ];
    results.passed = required.every((k) => results.contracts[k] === true);
    console.log(JSON.stringify(results, null, 2));
    process.exitCode = results.passed ? 0 : 1;
  } finally {
    child.kill();
    await sleep(300);
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows may hold handles briefly
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
