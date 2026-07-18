/**
 * In-process packaged-UI capture (ER-013), gated OFF by default.
 *
 * Activated ONLY when `COWORK_GHC_UI_AUDIT === "1"`. The packaged app's remote-debugging port is not
 * usable on this Electron build (the browser process rejects `--remote-debugging-port` as a "bad
 * option" and `app.commandLine.appendSwitch` does not open the endpoint either), so the UI-audit
 * tool drives capture from INSIDE the main process using only Electron APIs: `webContents
 * .capturePage()` for screenshots and `executeJavaScript()` for navigation/theme/synthetic unlock.
 *
 * This code never runs in a normal launch (the env flag is set solely by `tools/ui-audit`). It reads
 * no credentials, opens no network, and the caller isolates the data root via
 * `COWORK_GHC_RUNTIME_ROOT`. When done it writes `steps.json` + `checks.json` to
 * `COWORK_GHC_UI_AUDIT_OUT` and quits the app (so `before-quit` stops the service + child cleanly).
 */

import { app, screen, type BrowserWindow } from "electron";
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const AUDIT_ENV = "COWORK_GHC_UI_AUDIT";
const OUT_ENV = "COWORK_GHC_UI_AUDIT_OUT";
const SYNTH_USER = "audit";
const SYNTH_PASS = "cowork-audit-2026"; // throwaway; isolated disposable data root; >= 8 chars

interface StepInput {
  readonly id: string;
  readonly title: string;
  readonly theme: "light" | "dark";
  readonly viewport: "desktop" | "large";
  readonly expectSelector?: string;
}
interface StepResult extends StepInput {
  readonly size: string;
  readonly file: string;
  readonly bytes: number;
  readonly selectorFound: boolean;
  readonly contentOk: boolean;
}
interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const SURFACES: ReadonlyArray<{ id: string; label: string }> = [
  { id: "cowork", label: "Cowork" },
  { id: "skills-mcp", label: "Skill & MCP" },
  { id: "code", label: "Code" },
  { id: "knowledge", label: "Knowledge — kho tri thức local" },
  { id: "dispatch", label: "Dispatch (D1 chờ tích hợp)" },
  { id: "gateway", label: "Gateway (D4 chờ tích hợp)" },
  { id: "microsoft", label: "Microsoft 365 (D2 chờ tích hợp)" },
];

/** Returns true when audit mode ran (and the app will quit); false when disabled (normal launch). */
export function runUiAuditIfEnabled(window: BrowserWindow): boolean {
  if (process.env[AUDIT_ENV] !== "1") return false;
  void runAudit(window);
  return true;
}

async function runAudit(window: BrowserWindow): Promise<void> {
  const outDir = process.env[OUT_ENV]?.trim() || join(app.getPath("temp"), "cowork-ghc-ui-audit");
  const shotsDir = join(outDir, "screenshots");
  mkdirSync(shotsDir, { recursive: true });

  const steps: StepResult[] = [];
  const checks: CheckResult[] = [];
  const logLines: string[] = [];
  const wc = window.webContents;

  const log = (line: string): void => {
    const stamped = `${new Date().toISOString()} ${line}`;
    logLines.push(stamped);
    console.log(`[ui-audit] ${line}`);
  };
  const check = (name: string, ok: boolean, detail = ""): void => {
    checks.push({ name, ok, detail });
    log(`${ok ? "PASS" : "FAIL"} check:${name}${detail ? ` — ${detail}` : ""}`);
  };
  const evalJs = <T>(expr: string): Promise<T> => wc.executeJavaScript(expr, true) as Promise<T>;
  // Audit-only: call the loopback service directly from the renderer, reusing the in-memory bootstrap
  // token, to set the active workspace + run a REAL index over the seeded corpus. This exercises the
  // exact routes the panel uses — it never fabricates data. Returns the envelope `data`, or
  // `{ __error }` when the service replies with an error envelope.
  const svc = <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const bodyJs = body === undefined ? "undefined" : JSON.stringify(JSON.stringify(body));
    const expr = `(async () => {
      const b = await window.coworkShell.getBootstrap();
      const base = String(b.serviceBaseUrl).replace(/\\/$/, '');
      const headers = { authorization: 'Bearer ' + b.clientToken };
      const init = { method: ${JSON.stringify(method)}, headers };
      const bodyStr = ${bodyJs};
      if (bodyStr !== undefined) { init.body = bodyStr; headers['content-type'] = 'application/json'; }
      const res = await fetch(base + ${JSON.stringify(path)}, init);
      const env = await res.json();
      return env && env.ok ? env.data : { __error: (env && env.error) || 'no-envelope' };
    })()`;
    return evalJs<T>(expr);
  };
  const clickSel = (sel: string): Promise<boolean> =>
    evalJs<boolean>(
      `(() => { const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return false; n.click(); return true; })()`,
    );
  // Tolerant poll: executeJavaScript can reject while the document is mid-navigation; treat any
  // error as "not yet" rather than aborting the whole run.
  const waitFor = async (expr: string, timeoutMs = 15_000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await evalJs<boolean>(`!!(${expr})`)) return true;
      } catch {
        /* page not ready yet */
      }
      await delay(250);
    }
    return false;
  };
  const waitForLoad = (): Promise<void> =>
    new Promise((resolve) => {
      if (!wc.isLoadingMainFrame()) {
        resolve();
        return;
      }
      wc.once("did-finish-load", () => resolve());
      setTimeout(resolve, 30_000); // bounded fallback
    });

  const work = screen.getPrimaryDisplay().workAreaSize;
  const clamp = (w: number, h: number): { width: number; height: number } => ({
    width: Math.min(w, work.width),
    height: Math.min(h, work.height),
  });
  const sizes = {
    desktop: clamp(1440, 900),
    large: clamp(1920, 1080),
  } as const;

  const capture = async (s: StepInput): Promise<void> => {
    const vp = sizes[s.viewport];
    window.setContentSize(vp.width, vp.height);
    await delay(250);
    await evalJs(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(s.theme)})`);
    await delay(450); // layout + transitions settle
    const box = s.expectSelector
      ? await evalJs<{ w: number; h: number } | null>(
          `(() => { const n = document.querySelector(${JSON.stringify(s.expectSelector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()`,
        )
      : { w: vp.width, h: vp.height };
    const selectorFound = box !== null && box.w > 0 && box.h > 0;
    const image = await wc.capturePage();
    const png = image.toPNG();
    const file = `${s.id}.png`;
    writeFileSync(join(shotsDir, file), png);
    const bodyText = await evalJs<number>("document.body.innerText.trim().length");
    const contentOk = png.length >= 2000 && bodyText >= 5;
    if (s.expectSelector && !selectorFound) check(`selector:${s.id}`, false, `missing ${s.expectSelector}`);
    if (!contentOk) check(`content:${s.id}`, false, `png=${png.length}B text=${bodyText}`);
    steps.push({
      ...s,
      size: `${vp.width}x${vp.height}`,
      file: `screenshots/${file}`,
      bytes: png.length,
      selectorFound,
      contentOk,
    });
    log(`captured ${s.id} (${s.theme}, ${vp.width}x${vp.height}) ${png.length}B selector=${selectorFound}`);
  };

  try {
    log(`audit start; out=${outDir}; workArea=${work.width}x${work.height}`);
    await waitForLoad();
    const mounted = await waitFor(
      "document.querySelector('#app') && document.querySelector('#app').childElementCount > 0",
      30_000,
    );
    check("renderer-mounted", mounted, mounted ? "" : "#app never populated");

    // 1) First-run lock/setup screen (honest onboarding evidence — ER-002).
    const lockShown = await waitFor("document.querySelector('.app-lock')", 10_000);
    if (lockShown) {
      await capture({ id: "01-first-run-setup-light", title: "First run — create local account", theme: "light", viewport: "desktop", expectSelector: ".app-lock__card" });
      await capture({ id: "02-first-run-setup-dark", title: "First run — create local account (dark)", theme: "dark", viewport: "desktop", expectSelector: ".app-lock__card" });

      const submitted = await evalJs<boolean>(`(() => {
        const setVal = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
        const user = document.querySelector('.app-lock input[type=text]');
        const pass = document.querySelector('.app-lock input[type=password]');
        if (!user || !pass) return false;
        setVal(user, ${JSON.stringify(SYNTH_USER)});
        setVal(pass, ${JSON.stringify(SYNTH_PASS)});
        const btn = document.querySelector('.app-lock__submit');
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      check("unlock-submitted", submitted, submitted ? "" : "lock inputs/submit missing");
      const unlocked = await waitFor("!document.querySelector('.app-lock')", 20_000);
      if (!unlocked) {
        const err = await evalJs<string>(
          "(document.querySelector('.app-lock__error') && !document.querySelector('.app-lock__error').hidden) ? document.querySelector('.app-lock__error').textContent : ''",
        );
        check("unlocked", false, `still locked${err ? `: ${err}` : ""}`);
      } else {
        check("unlocked", true);
      }
    } else {
      check("first-run-lock", false, ".app-lock not shown (unexpected on fresh data root)");
    }

    // 2) Product rail interactive?
    const railReady = await waitFor(
      "document.querySelector('.product-rail') && !document.querySelector('.app-lock')",
      20_000,
    );
    check("product-rail", railReady, railReady ? "" : "rail not interactive");

    if (railReady) {
      // 3) Each surface, both themes.
      let n = 3;
      for (const s of SURFACES) {
        const clicked = await clickSel(`button[data-surface-id="${s.id}"]`);
        if (!clicked) {
          check(`nav:${s.id}`, false, "rail button missing");
          continue;
        }
        await delay(500);
        const idx = String(n).padStart(2, "0");
        await capture({ id: `${idx}-surface-${s.id}-light`, title: `${s.label} — light`, theme: "light", viewport: "desktop", expectSelector: ".product-rail" });
        await capture({ id: `${idx}-surface-${s.id}-dark`, title: `${s.label} — dark`, theme: "dark", viewport: "desktop", expectSelector: ".product-rail" });
        n += 1;
      }

      // 3b) Knowledge surface states reachable in the isolated audit env (no workspace configured):
      // the honest no-workspace empty state (both themes) and the empty Đồ thị (graph) tab. The
      // data-rich states (document list / search / graph-with-data) require an interactively selected
      // workspace + a real index, which is a Product-Owner acceptance step — never faked here.
      {
        const toKnowledge = await clickSel('button[data-surface-id="knowledge"]');
        if (toKnowledge) {
          await waitFor("document.querySelector('.knowledge-view') && !document.querySelector('.knowledge-view').hidden", 8_000);
          await capture({ id: "18-knowledge-no-workspace-light", title: "Knowledge — chưa chọn workspace", theme: "light", viewport: "desktop", expectSelector: ".klp" });
          await capture({ id: "19-knowledge-no-workspace-dark", title: "Knowledge — chưa chọn workspace (dark)", theme: "dark", viewport: "desktop", expectSelector: ".klp" });
          // Đồ thị (graph) tab — empty state, still an honest packaged view (no blank canvas).
          const toGraph = await clickSel('[data-knowledge-tab="graph"]');
          if (toGraph) {
            await delay(500);
            await capture({ id: "19b-knowledge-graph-empty-light", title: "Knowledge — đồ thị (trống)", theme: "light", viewport: "desktop", expectSelector: ".knowledge-view" });
          }
          await clickSel('[data-knowledge-tab="base"]');
          await delay(200);
        } else {
          check("nav:knowledge-states", false, "knowledge rail button missing");
        }
      }

      // 3c) Data-rich Knowledge — point the app at the seeded workspace, run a REAL local index, and
      // capture the populated states (document list / detail / FTS search / graph / node detail), then
      // a real re-sync after an on-disk change + delete (prune), then the safe destructive clear that
      // keeps the source files. Requires the seed dir handed in by tools/ui-audit; skipped if absent.
      const seedWs = process.env.COWORK_GHC_UI_AUDIT_WORKSPACE?.trim();
      if (seedWs !== undefined && seedWs.length > 0) {
        log(`data-rich knowledge: seeding active workspace ${seedWs}`);
        const setRes = await svc<{ __error?: unknown }>("PUT", "/v1/settings/active-workspace", {
          rootPath: seedWs,
        });
        check("knowledge-set-workspace", !setRes?.__error, setRes?.__error ? JSON.stringify(setRes.__error) : "");
        await svc("POST", "/v1/knowledge-local/sync");

        type KStatus = { status: string; documentCount: number; nodeCount: number; edgeCount: number };
        const readyBy = Date.now() + 90_000;
        let view: KStatus | null = null;
        while (Date.now() < readyBy) {
          const st = await svc<{ status?: KStatus }>("GET", "/v1/knowledge-local/status");
          view = st?.status ?? null;
          if (view !== null && view.status !== "indexing" && view.status !== "not_initialized") break;
          await delay(600);
        }
        const indexed = view !== null && view.documentCount > 0 && (view.status === "ready" || view.status === "partial");
        check(
          "knowledge-indexed",
          indexed,
          view !== null ? `status=${view.status} docs=${view.documentCount} nodes=${view.nodeCount} edges=${view.edgeCount}` : "no status",
        );

        // Navigate to Knowledge; the panel refreshes status + loads the now-real document list.
        await clickSel('button[data-surface-id="knowledge"]');
        await clickSel('[data-knowledge-tab="base"]');
        const docsShown = await waitFor("document.querySelector('.klp-doc')", 12_000);
        check("knowledge-doc-list", docsShown, docsShown ? "" : "no .klp-doc rendered");
        await capture({ id: "40-knowledge-docs-light", title: "Knowledge — danh sách tài liệu (có dữ liệu)", theme: "light", viewport: "desktop", expectSelector: ".klp-kb" });
        await capture({ id: "41-knowledge-docs-dark", title: "Knowledge — danh sách tài liệu (dark)", theme: "dark", viewport: "desktop", expectSelector: ".klp-kb" });

        // Document detail — provenance badge + safe path + Mở nguồn / Hỏi Cowork handoffs.
        await clickSel(".klp-doc");
        const detailShown = await waitFor("document.querySelector('.klp-detail')", 8_000);
        check("knowledge-doc-detail", detailShown, detailShown ? "" : "no .klp-detail");
        await capture({ id: "42-knowledge-doc-detail-light", title: "Knowledge — chi tiết tài liệu + nguồn", theme: "light", viewport: "desktop", expectSelector: ".klp-detail" });

        // Real FTS keyword search — a term present across the corpus → highlighted snippet + provenance.
        const typed = await evalJs<boolean>(`(() => {
          const inp = document.querySelector('.klp-search__input');
          if (!inp) return false;
          inp.value = 'knowledge';
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`);
        check("knowledge-search-typed", typed, typed ? "" : "search input missing");
        const hitsShown = await waitFor("document.querySelector('.klp-hit')", 8_000);
        check("knowledge-search-hits", hitsShown, hitsShown ? "" : "no .klp-hit");
        await capture({ id: "43-knowledge-search-light", title: "Knowledge — tìm kiếm FTS + snippet + nguồn", theme: "light", viewport: "desktop", expectSelector: ".klp-results" });

        // Clear search, open the graph tab — expect a real node/edge graph (not a blank canvas).
        await evalJs(`(() => { const inp = document.querySelector('.klp-search__input'); if (inp) { inp.value=''; inp.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
        await clickSel('[data-knowledge-tab="graph"]');
        const nodesShown = await waitFor("document.querySelector('[data-node-id]')", 12_000);
        check("knowledge-graph-nodes", nodesShown, nodesShown ? "" : "no graph nodes");
        await capture({ id: "44-knowledge-graph-light", title: "Knowledge — đồ thị (nút/cạnh thật)", theme: "light", viewport: "desktop", expectSelector: ".klp-graph" });

        // Select a node → detail aside with provenance + link count. SVG <g> nodes have no `.click()`
        // (that is HTMLElement-only), so dispatch a bubbling MouseEvent the graph's listener handles.
        const nodeClicked = await evalJs<boolean>(`(() => {
          const n = document.querySelector('[data-node-id]');
          if (!n) return false;
          n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        })()`);
        check("knowledge-graph-node-click", nodeClicked, nodeClicked ? "" : "no node to click");
        const nodeDetail = await waitFor("document.querySelector('.klp-graph__aside-title')", 6_000);
        check("knowledge-graph-node-detail", nodeDetail, nodeDetail ? "" : "no node detail aside");
        await capture({ id: "45-knowledge-graph-node-light", title: "Knowledge — chọn nút + chi tiết nguồn", theme: "light", viewport: "desktop", expectSelector: ".klp-graph__aside" });

        // Real re-sync after an on-disk change + delete → prune. Mutate the seed, then sync again.
        try {
          appendFileSync(join(seedWs, "notes.txt"), "\nAppended during audit to force a re-index.\n");
          rmSync(join(seedWs, "standalone.md"), { force: true });
        } catch {
          /* best effort — the prune check below reports if it did not take */
        }
        await svc("POST", "/v1/knowledge-local/sync");
        const reReadyBy = Date.now() + 60_000;
        let view2: KStatus | null = null;
        while (Date.now() < reReadyBy) {
          const st = await svc<{ status?: KStatus }>("GET", "/v1/knowledge-local/status");
          view2 = st?.status ?? null;
          if (view2 !== null && view2.status !== "indexing") break;
          await delay(600);
        }
        const pruned = view !== null && view2 !== null && view2.documentCount < view.documentCount;
        check("knowledge-resync-prune", pruned, view !== null && view2 !== null ? `before=${view.documentCount} after=${view2.documentCount}` : "no status");
        await clickSel('[data-knowledge-tab="base"]');
        await waitFor("document.querySelector('.klp-doc')", 8_000);
        await capture({ id: "46-knowledge-resync-light", title: "Knowledge — đồng bộ lại sau thay đổi/xóa (prune)", theme: "light", viewport: "desktop", expectSelector: ".klp-kb" });

        // Safe destructive clear: More ▾ → Xóa chỉ mục → confirmation → confirm → not_initialized.
        await clickSel('.klp-menu button[aria-haspopup="menu"]');
        await delay(200);
        await clickSel(".klp-menu__item--danger");
        const confirmShown = await waitFor("document.querySelector('.klp-status__confirm')", 4_000);
        check("knowledge-clear-confirm", confirmShown, confirmShown ? "" : "no confirm prompt");
        await capture({ id: "47-knowledge-clear-confirm-light", title: "Knowledge — xác nhận xóa chỉ mục (an toàn)", theme: "light", viewport: "desktop", expectSelector: ".klp-status__confirm" });
        await clickSel(".klp-status__confirm .klp-btn--danger");
        const backToInit = await waitFor("document.querySelector('.klp-chip--not_initialized')", 8_000);
        check("knowledge-cleared", backToInit, backToInit ? "" : "did not return to not_initialized");
        // The index clear must NOT touch the source files on disk.
        const filesKept = existsSync(join(seedWs, "README.md")) && existsSync(join(seedWs, "docs", "overview.md"));
        check("knowledge-clear-keeps-files", filesKept, filesKept ? "" : "seed files missing after clear");
        await capture({ id: "48-knowledge-cleared-light", title: "Knowledge — sau khi xóa chỉ mục (file gốc giữ nguyên)", theme: "light", viewport: "desktop", expectSelector: ".klp" });

        // Leave the app on Cowork so the subsequent Settings/large-viewport steps start clean.
        await clickSel('button[data-surface-id="cowork"]');
        await delay(300);
      }

      // 4) Settings surface (provider + general tabs).
      await clickSel('button[data-surface-id="cowork"]');
      await delay(300);
      const settingsOpened = await clickSel(".topbar__settings");
      if (settingsOpened) {
        await waitFor("document.querySelector('.settings-surface') && !document.querySelector('.settings-surface').hidden", 8_000);
        await capture({ id: "20-settings-provider-light", title: "Settings — Nhà cung cấp", theme: "light", viewport: "desktop", expectSelector: ".settings-surface" });
        await capture({ id: "21-settings-provider-dark", title: "Settings — Nhà cung cấp (dark)", theme: "dark", viewport: "desktop", expectSelector: ".settings-surface" });
        await evalJs("(() => { const tabs = document.querySelectorAll('.settings-surface__tab'); if (tabs[1]) tabs[1].click(); })()");
        await delay(300);
        await capture({ id: "22-settings-general-light", title: "Settings — Chung", theme: "light", viewport: "desktop", expectSelector: ".settings-surface" });
        await evalJs("(() => { const b = document.querySelector('.settings-surface__close'); if (b) b.click(); })()");
      } else {
        check("settings-open", false, ".topbar__settings missing");
      }

      // 5) Key surfaces at the largest fitting viewport (light).
      await clickSel('button[data-surface-id="cowork"]');
      await delay(400);
      await capture({ id: "30-cowork-large-light", title: "Cowork — large", theme: "light", viewport: "large", expectSelector: ".product-rail" });
      await clickSel('button[data-surface-id="code"]');
      await delay(400);
      await capture({ id: "31-code-large-light", title: "Code — large", theme: "light", viewport: "large", expectSelector: ".product-rail" });
    }
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    check("audit-exception", false, message.slice(0, 300));
    log(`ERROR: ${message}`);
  } finally {
    try {
      writeFileSync(join(outDir, "steps.json"), JSON.stringify(steps, null, 2));
      writeFileSync(join(outDir, "checks.json"), JSON.stringify(checks, null, 2));
      writeFileSync(join(outDir, "audit-shell.log"), logLines.join("\n") + "\n");
    } catch {
      /* best effort */
    }
    log(`audit done: ${steps.length} screenshots, ${checks.filter((c) => !c.ok).length} failed checks`);
    app.quit();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
