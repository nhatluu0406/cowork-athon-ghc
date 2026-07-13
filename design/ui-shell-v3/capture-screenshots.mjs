/**
 * Capture UI Shell V3 design prototype screenshots.
 * Design artifact only — not production verification.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const HTML = join(HERE, "index.html");
const OUT = join(REPO, "reports", "ui-shell-v3");

const SHOTS = [
  { file: "main-1920.png", state: "cowork-active", width: 1920, height: 1080 },
  { file: "main-1366.png", state: "cowork-active", width: 1366, height: 768 },
  { file: "main-900.png", state: "narrow-900", width: 900, height: 768 },
  { file: "workspace.png", state: "workspace", width: 1920, height: 1080 },
  { file: "inspector-open.png", state: "cowork-inspector-open", width: 1920, height: 1080 },
  { file: "gateway.png", state: "gateway", width: 1366, height: 768 },
  { file: "knowledge-graph.png", state: "knowledge-graph", width: 1366, height: 768 },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
const path = require('path');
const shots = ${JSON.stringify(SHOTS)};
const base = ${JSON.stringify(base)};
const out = ${JSON.stringify(OUT)};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(base);
  await page.waitForFunction(() => window.__cghcV3Prototype);
  for (const s of shots) {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.evaluate((state) => window.__cghcV3Prototype.applyState(state), s.state);
    await page.evaluate(() => { document.body.dataset.screenshot = 'true'; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, s.file), fullPage: false });
    console.log('screenshot:', path.join(out, s.file));
  }
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
    // Fallback: npx playwright if not installed locally
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
