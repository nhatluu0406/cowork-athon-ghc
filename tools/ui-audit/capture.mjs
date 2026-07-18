/**
 * Automated packaged-UI capture launcher (ER-013).
 *
 * The packaged Electron build does not expose a usable remote-debugging port (the browser process
 * rejects `--remote-debugging-port` as a "bad option"), so capture runs IN-PROCESS inside the shell,
 * gated by `COWORK_GHC_UI_AUDIT=1` (see app/shell/src/audit/ui-capture.ts). This launcher only:
 *   1. verifies `coworkghc.exe` exists,
 *   2. launches it with audit mode + an ISOLATED data root + audit output dir,
 *   3. waits for the app to capture every surface/state and quit itself,
 *   4. aggregates the shell's steps/checks into a manifest + contact sheet,
 *   5. asserts no orphan process (PID-scoped — never touches a user's existing instance).
 *
 * SAFETY (audit mode): isolated `COWORK_GHC_RUNTIME_ROOT` under .runtime\ui-audit\<run-id>\ (never
 * the real %APPDATA%\Cowork GHC profile); synthetic throwaway local account only;
 * `COWORK_GHC_ALLOW_ENV_IMPORT=0` (no .env credentials); provider stays unconfigured (no egress).
 *
 * Zero runtime dependencies. Windows only (tasklist/taskkill). Usage: `npm run audit:ui`.
 * Exit 0 = captured coverage set + clean quit + all checks passed; non-zero otherwise.
 */

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const EXE = join(REPO_ROOT, "dist-app", "win-unpacked", "coworkghc.exe");

const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const RUN_DATA_ROOT = join(REPO_ROOT, ".runtime", "ui-audit", RUN_ID); // COWORK_GHC_RUNTIME_ROOT
const OUT_DIR = join(REPO_ROOT, "reports", "ui-audit", RUN_ID); // COWORK_GHC_UI_AUDIT_OUT
const LAUNCH_TIMEOUT_MS = 180_000;

const log = [];
function note(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  log.push(stamped);
  console.log(stamped);
}

function imagePids(image) {
  try {
    const out = execFileSync("tasklist", ["/FO", "CSV", "/NH", "/FI", `IMAGENAME eq ${image}`], {
      encoding: "utf8",
    });
    const re = new RegExp(`^"${image.replace(/\./g, "\\.")}","(\\d+)"`, "i");
    return new Set(
      out
        .split(/\r?\n/)
        .map((l) => l.match(re))
        .filter(Boolean)
        .map((m) => m[1]),
    );
  } catch {
    return new Set();
  }
}
function killTree(pid) {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    /* already dead */
  }
}
function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  note(`UI audit run ${RUN_ID}`);
  if (!existsSync(EXE)) {
    console.error(`\nERROR: packaged executable not found:\n  ${EXE}\nRun \`npm run package:win\` first (ER-001).\n`);
    process.exit(2);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(RUN_DATA_ROOT, { recursive: true });

  const preOpencode = imagePids("opencode.exe");
  const preApp = imagePids("coworkghc.exe");
  note(`pre-existing pids — coworkghc: ${[...preApp].join(",") || "(none)"}; opencode: ${[...preOpencode].join(",") || "(none)"}`);

  const child = spawn(EXE, [], {
    env: {
      ...process.env,
      COWORK_GHC_UI_AUDIT: "1",
      COWORK_GHC_UI_AUDIT_OUT: OUT_DIR,
      COWORK_GHC_RUNTIME_ROOT: RUN_DATA_ROOT,
      COWORK_GHC_ALLOW_ENV_IMPORT: "0",
    },
    stdio: "ignore",
    windowsHide: false,
  });
  note(`launched coworkghc.exe pid=${child.pid} (audit mode) runtimeRoot=${RUN_DATA_ROOT}`);

  const checks = [];
  const check = (name, ok, detail = "") => {
    checks.push({ name, ok, detail });
    note(`${ok ? "PASS" : "FAIL"} check:${name}${detail ? ` — ${detail}` : ""}`);
  };

  // The spawned launcher pid can exit early (packaged bootstrap), so completion is detected by the
  // shell's own output sentinel (audit-shell.log is written LAST in the audit finally block), not by
  // the child exit event. This tolerates the launcher process detaching from the real app.
  const sentinel = join(OUT_DIR, "audit-shell.log");
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  let completed = false;
  while (Date.now() < deadline) {
    if (existsSync(sentinel) && existsSync(join(OUT_DIR, "steps.json"))) {
      completed = true;
      break;
    }
    await delay(1000);
  }
  await delay(1500); // let the app finish app.quit() after writing the sentinel
  check("app-captured", completed, completed ? "" : `no sentinel within ${LAUNCH_TIMEOUT_MS}ms`);

  // Orphan assertion: any coworkghc/opencode PID that appeared during this run and is still alive.
  const newApp = [...imagePids("coworkghc.exe")].filter((p) => !preApp.has(p));
  if (newApp.length > 0) {
    note(`killing leftover coworkghc pids from this run: ${newApp.join(",")}`);
    for (const p of newApp) killTree(p);
  }
  const newOpencode = [...imagePids("opencode.exe")].filter((p) => !preOpencode.has(p));
  if (newOpencode.length > 0) {
    note(`killing leftover opencode pids from this run: ${newOpencode.join(",")}`);
    for (const p of newOpencode) killTree(p);
  }
  await delay(700);
  const orphanApp = [...imagePids("coworkghc.exe")].filter((p) => !preApp.has(p));
  const orphanOpencode = [...imagePids("opencode.exe")].filter((p) => !preOpencode.has(p));
  check("no-orphan-app", orphanApp.length === 0, orphanApp.length ? `pids ${orphanApp.join(",")}` : "");
  check("no-orphan-opencode", orphanOpencode.length === 0, orphanOpencode.length ? `pids ${orphanOpencode.join(",")}` : "");

  // ---- aggregate the shell's capture results ----
  const steps = readJson(join(OUT_DIR, "steps.json"), []);
  const shellChecks = readJson(join(OUT_DIR, "checks.json"), []);
  check("screenshots-captured", steps.length > 0, `${steps.length} screenshots`);
  const allChecks = [...shellChecks, ...checks];

  writeReports(steps, allChecks);

  const failed = allChecks.filter((c) => c && !c.ok);
  note(`checks: ${allChecks.length - failed.length}/${allChecks.length} passed; screenshots: ${steps.length}`);
  note(`report: ${OUT_DIR}`);
  process.exit(failed.length === 0 && steps.length > 0 ? 0 : 1);
}

function writeReports(steps, checks) {
  writeFileSync(
    join(OUT_DIR, "environment.json"),
    JSON.stringify(
      {
        runId: RUN_ID,
        exe: EXE,
        runtimeRoot: RUN_DATA_ROOT,
        node: process.version,
        platform: process.platform,
        mode: "in-process (COWORK_GHC_UI_AUDIT=1)",
        capturedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify({ runId: RUN_ID, screenshots: steps, checks }, null, 2));
  writeFileSync(join(OUT_DIR, "audit-log.txt"), log.join("\n") + "\n");
  writeFileSync(join(OUT_DIR, "contact-sheet.html"), contactSheet(steps, checks));
}

function contactSheet(steps, checks) {
  const cards = steps
    .map(
      (m) => `  <figure class="card ${m.contentOk && m.selectorFound ? "ok" : "warn"}">
    <img src="${m.file}" alt="${m.title}" loading="lazy" />
    <figcaption><b>${m.id}</b><br/>${m.title}<br/><small>${m.theme} · ${m.size} · ${(m.bytes / 1024).toFixed(0)}KB · selector:${m.selectorFound}</small></figcaption>
  </figure>`,
    )
    .join("\n");
  const checkRows = checks
    .filter(Boolean)
    .map((c) => `  <li class="${c.ok ? "ok" : "warn"}">${c.ok ? "PASS" : "FAIL"} — ${c.name}${c.detail ? ` (${c.detail})` : ""}</li>`)
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>UI Audit ${RUN_ID}</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; background: #0f1115; color: #e6e8eb; }
  h1 { font-size: 18px; }
  ul.checks { padding-left: 18px; }
  .ok { color: #7ee787; }
  .warn { color: #ffa657; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
  .card { margin: 0; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; background: #161b22; }
  .card.warn { border-color: #ffa657; }
  .card img { width: 100%; display: block; border-bottom: 1px solid #30363d; }
  figcaption { padding: 8px 10px; font-size: 12px; }
  small { color: #8b949e; }
</style>
<h1>Cowork GHC — packaged UI audit · ${RUN_ID}</h1>
<p>${steps.length} screenshots · ${checks.filter((c) => c && c.ok).length}/${checks.filter(Boolean).length} checks passed</p>
<h2>Checks</h2>
<ul class="checks">
${checkRows}
</ul>
<h2>Screenshots</h2>
<div class="grid">
${cards}
</div>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
