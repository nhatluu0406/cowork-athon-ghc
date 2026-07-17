/**
 * Bounded loopback static file server for the `static` preview kind.
 *
 * Serves GET/HEAD only, from the active workspace ROOT, over `127.0.0.1:<port>`. Every request
 * path is decoded, resolved, and re-confined with the workspace realpath check so `..` and
 * symlink escapes cannot read outside the workspace. This is NOT a general web server: no
 * uploads, no directory listing, no execution — just files the user already trusts in their
 * workspace, rendered in the embedded preview.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";
import { realPathInsideRoot } from "../workspace/realpath.js";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export interface StaticServerHandle {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
}

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** Start a bounded static server confined to `root`, bound to loopback `port`. */
export async function startStaticServer(root: string, port: number): Promise<StaticServerHandle> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
        res.end("Method Not Allowed");
        return;
      }
      let pathname: string;
      try {
        pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
      } catch {
        res.writeHead(400).end("Bad Request");
        return;
      }
      if (pathname.endsWith("/")) pathname += "index.html";
      // Strip the leading slash so join treats it as workspace-relative.
      const relative = pathname.replace(/^\/+/, "");
      const candidate = join(root, relative);
      const safe = await realPathInsideRoot(root, candidate);
      if (safe === undefined) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" }).end("Forbidden");
        return;
      }
      let fileStat;
      try {
        fileStat = await stat(safe);
      } catch {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not Found");
        return;
      }
      if (fileStat.isDirectory()) {
        // Directory request without a trailing slash → try its index.html.
        const indexPath = join(safe, "index.html");
        const safeIndex = await realPathInsideRoot(root, indexPath);
        if (safeIndex === undefined) {
          res.writeHead(403).end("Forbidden");
          return;
        }
        try {
          await stat(safeIndex);
        } catch {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not Found");
          return;
        }
        serveFile(safeIndex, req.method === "HEAD", res);
        return;
      }
      serveFile(safe, req.method === "HEAD", res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end("Internal Error");
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };

  function serveFile(path: string, headOnly: boolean, res: import("node:http").ServerResponse): void {
    res.setHeader("content-type", contentTypeFor(path));
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cache-control", "no-store");
    if (headOnly) {
      res.writeHead(200).end();
      return;
    }
    const stream = createReadStream(path);
    stream.on("error", () => {
      if (!res.headersSent) res.writeHead(500).end("Internal Error");
      else res.end();
    });
    stream.pipe(res);
  }
}
