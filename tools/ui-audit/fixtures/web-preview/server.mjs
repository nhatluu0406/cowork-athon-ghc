/**
 * Deterministic, zero-dependency dev server for the packaged Code Web Preview audit.
 *
 * This is the `dev` script the audit picks from package.json. It binds the loopback PORT the
 * runner injects (buildPreviewEnv sets PORT + HOST=127.0.0.1), serves a tiny static page that
 * carries a UNIQUE marker string, and prints a Vite-style "Local: http://localhost:PORT/" line
 * so the runner's URL detector confirms `running`. No dependencies, no network, no writes — it
 * only reads its own request and responds, so it is safe to run from an isolated throwaway
 * workspace copy. Terminating it (whole-tree taskkill) closes the port immediately.
 *
 * NOTE: this is test tooling, never shipped in the packaged app.
 */
import { createServer } from "node:http";

/** Unique, greppable marker the audit asserts is actually rendered in the embedded preview. */
const MARKER = "COWORK-GHC-PREVIEW-FIXTURE-LIVE";

const PORT = Number.parseInt(process.env.PORT ?? "0", 10) || 0;
const HOST = process.env.HOST && process.env.HOST.length > 0 ? process.env.HOST : "127.0.0.1";

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cowork GHC preview fixture</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #0e7490; color: #ecfeff; }
      main { min-height: 100vh; display: grid; place-items: center; text-align: center; padding: 32px; }
      h1 { font-size: 28px; margin: 0 0 8px; }
      .marker { font-family: ui-monospace, monospace; font-size: 15px; background: rgba(0,0,0,.25); padding: 6px 12px; border-radius: 8px; }
      p { opacity: .9; }
    </style>
  </head>
  <body>
    <main>
      <div>
        <h1>Web preview is live</h1>
        <p>Served over loopback HTTP by the audit fixture dev server.</p>
        <p class="marker" data-marker>${MARKER}</p>
      </div>
    </main>
  </body>
</html>
`;

const server = createServer((req, res) => {
  // GET/HEAD only; every path returns the same deterministic page.
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" }).end("Method Not Allowed");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(req.method === "HEAD" ? undefined : PAGE);
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : PORT;
  // Mimic a real dev server's startup banner; the runner detects the loopback URL from this line.
  console.log("cghc-web-preview-fixture: starting dev server");
  console.log(`  ready`);
  console.log(`  ➜  Local:   http://localhost:${boundPort}/`);
});

// Keep the event loop alive until the process tree is terminated by the runner.
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
