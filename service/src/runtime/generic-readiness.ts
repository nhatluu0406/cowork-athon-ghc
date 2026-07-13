/**
 * Role-agnostic readiness probes for {@link GenericChildSupervisor} (ADR 0010). Postgres, Neo4j,
 * the M365KG backend, and `llm-svc` each get "ready" differently — this module supplies the two
 * generic mechanisms that cover all four (a raw TCP connect, and an HTTP `GET` returning 2xx);
 * anything more specific (e.g. `pg_isready`) lives next to the role that needs it.
 */

import net from "node:net";

/** Resolve `true` once the child at `host:port` is considered ready. */
export type ReadinessProbe = (host: string, port: number, signal: AbortSignal) => Promise<boolean>;

/** Ready as soon as a TCP connection to `host:port` succeeds (Neo4j bolt, llm-svc gRPC). */
export function tcpConnectProbe(): ReadinessProbe {
  return (host, port, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve(false);
        return;
      }
      const socket = net.connect({ host, port });
      const onDone = (ok: boolean): void => {
        signal.removeEventListener("abort", onAbort);
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };
      const onAbort = (): void => onDone(false);
      signal.addEventListener("abort", onAbort);
      socket.once("connect", () => onDone(true));
      socket.once("error", () => onDone(false));
    });
}

/** Ready when `GET http://host:port{path}` returns a 2xx (the M365KG backend's `/health`). */
export function httpOkProbe(path: string): ReadinessProbe {
  return async (host, port, signal) => {
    try {
      const res = await fetch(`http://${host}:${port}${path}`, { signal });
      return res.ok;
    } catch {
      return false;
    }
  };
}
