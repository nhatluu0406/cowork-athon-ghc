/**
 * Detect the actual loopback URL/port a dev server prints, and allocate free loopback ports.
 *
 * Dev servers pick their own port; the runner steers common frameworks with `PORT`, but the
 * authoritative source is the URL the server prints on startup ("Local: http://localhost:5173/").
 * We normalise any loopback/wildcard host to `127.0.0.1` for embedding.
 */

import net from "node:net";

const URL_RE =
  /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\])(?::(\d{2,5}))?/i;

export interface DetectedUrl {
  readonly url: string;
  readonly port: number;
}

/** Parse the first embeddable loopback URL in a line, or `null`. */
export function detectUrlInLine(line: string): DetectedUrl | null {
  const m = URL_RE.exec(line);
  if (m === null) return null;
  const scheme = line.slice(m.index, m.index + 5).toLowerCase().startsWith("https") ? "https" : "http";
  const port = m[2] !== undefined ? Number.parseInt(m[2], 10) : scheme === "https" ? 443 : 80;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { url: `${scheme}://127.0.0.1:${port}`, port };
}

/** Allocate an ephemeral free loopback port. */
export function allocateLoopbackPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error("port allocation failed"))));
    });
  });
}

/** True if a TCP connection to the loopback port succeeds within `timeoutMs`. */
export function probeLoopbackPort(port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, "127.0.0.1");
  });
}
