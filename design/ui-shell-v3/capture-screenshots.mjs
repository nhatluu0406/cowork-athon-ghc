/**
 * Capture UI Shell V3 R3 design prototype screenshots.
 * Runs visibility assertions before each capture; fails on invariant violation.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const HTML = join(HERE, "index.html");
const OUT = join(REPO, "reports", "ui-shell-v3-r3");
const CHECK_JSON = join(OUT, "visual-state-check.json");

const SHOTS = [
  { file: "cowork-1920.png", state: "cowork-active", width: 1920, height: 1080 },
  { file: "cowork-1366.png", state: "cowork-active", width: 1366, height: 768 },
  { file: "cowork-900.png", state: "cowork-900", width: 900, height: 768 },
  { file: "cowork-inspector.png", state: "cowork-inspector-open", width: 1920, height: 1080 },
  { file: "workspace-empty.png", state: "workspace-empty", width: 1920, height: 1080 },
  { file: "workspace-file.png", state: "workspace-file", width: 1920, height: 1080 },
  { file: "workspace-file-review.png", state: "workspace-file-review", width: 1920, height: 1080 },
  { file: "workspace-900.png", state: "workspace-900", width: 900, height: 768 },
  { file: "knowledge-no-graph.png", state: "knowledge-no-graph", width: 1366, height: 768 },
  { file: "knowledge-base.png", state: "knowledge-base", width: 1366, height: 768 },
  { file: "knowledge-graph.png", state: "knowledge-graph", width: 1366, height: 768 },
  { file: "gateway.png", state: "gateway", width: 1366, height: 768 },
  { file: "provider-missing.png", state: "provider-missing", width: 1920, height: 1080 },
  { file: "provider-failed.png", state: "provider-failed", width: 1920, height: 1080 },
  { file: "waiting-permission.png", state: "waiting-permission", width: 1920, height: 1080 },
];

async function runPlaywright() {
  const { createServer } = await import("node:http");
  const { readFileSync } = await import("node:fs");
  const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

  const server = createServer((req, res) => {
    const rel = (req.url ?? "/").split("?")[0] === "/" ? "/index.html" : (req.url ?? "/index.html").split("?")[0];
    const file = join(HERE, rel.replace(/^\//, ""));
    const ext = rel.slice(rel.lastIndexOf("."));
    res.writeHead(200, { "Content-Type": mime[ext] ?? "text/plain" });
    res.end(readFileSync(file));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;

  const script = `
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const shots = ${JSON.stringify(SHOTS)};
const base = ${JSON.stringify(base)};
const out = ${JSON.stringify(OUT)};
const checkJson = ${JSON.stringify(CHECK_JSON)};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function settle(page, state) {
  return page.evaluate(async (s) => window.__cghcV3Prototype.applyStateAndSettle(s), state);
}

(async () => {
  const browser = await chromium.launch();
  const results = [];

  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForFunction(() => window.__cghcV3Prototype);
    const seq = await page.evaluate(() => window.__cghcV3Prototype.runSequentialTransitionTest());
    if (!seq.passed) {
      console.error('sequential transition failed at', seq.failedAt, JSON.stringify(seq.results.at(-1), null, 2));
      process.exit(1);
    }
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForFunction(() => window.__cghcV3Prototype);
    await settle(page, 'cowork-active');
    const click = await page.evaluate(() => {
      window.__cghcV3Prototype.openFileFromChat('src/README.md', 'README.md');
      return window.__cghcV3Prototype.assertClickFromChat();
    });
    if (!click.passed) {
      console.error('click-from-chat failed', click.errors.join('; '));
      process.exit(1);
    }
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForFunction(() => window.__cghcV3Prototype);
    await settle(page, 'cowork-active');
    const broken = await page.evaluate(() => {
      document.querySelector('.view[data-view="workspace"]').hidden = false;
      return window.__cghcV3Prototype.assertVisualState('cowork-active');
    });
    if (broken.passed) {
      console.error('expected assertion failure when cowork+workspace both visible');
      process.exit(1);
    }
    await ctx.close();
  }

  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.waitForFunction(() => window.__cghcV3Prototype);

    const check = await settle(page, s.state);
    const record = {
      state: s.state,
      file: s.file,
      workMode: check.workMode,
      visibleViews: check.visibleViews,
      visibleSidebarPanels: check.visibleSidebarPanels,
      visibleDocTabLabels: check.visibleDocTabLabels,
      sidebarVisible: check.sidebarVisible,
      inspectorVisible: check.inspectorVisible,
      horizontalOverflow: check.horizontalOverflow,
      passed: check.passed,
      errors: check.errors,
    };
    results.push(record);

    if (!check.passed) {
      console.error('assertion failed for', s.state, check.errors.join('; '));
      await ctx.close();
      await browser.close();
      fs.writeFileSync(checkJson, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
      process.exit(1);
    }

    await page.evaluate(() => { document.body.dataset.screenshot = 'true'; });
    await sleep(200);
    await page.screenshot({ path: path.join(out, s.file), fullPage: false });
    console.log('screenshot:', path.join(out, s.file));
    await ctx.close();
  }

  fs.writeFileSync(checkJson, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log('visual-state-check:', checkJson);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
`;

  const child = spawn(process.execPath, ["-e", script], {
    cwd: REPO,
    stdio: "inherit",
    env: { ...process.env, NODE_PATH: join(REPO, "node_modules") },
  });

  const code = await new Promise((resolve) => child.on("close", resolve));
  server.close();
  if (code !== 0) throw new Error(`playwright capture failed: ${code}`);
}

async function main() {
  if (!existsSync(HTML)) throw new Error(`missing ${HTML}`);
  mkdirSync(OUT, { recursive: true });

  try {
    await runPlaywright();
  } catch {
    const installer = spawn(
      "npx",
      ["--yes", "playwright", "install", "chromium"],
      { cwd: REPO, stdio: "inherit", shell: true },
    );
    const installCode = await new Promise((r) => installer.on("close", r));
    if (installCode !== 0) throw new Error("playwright install failed");
    await runPlaywright();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
