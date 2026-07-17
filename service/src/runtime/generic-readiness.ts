/**
 * Readiness probes for the generic bundled-child supervisor ({@link GenericChildSupervisor}),
 * ADR 0010. A {@link ReadinessProbe} answers a single bounded "is this child accepting
 * connections yet?" question; the supervisor polls it (each call abortable) until it returns
 * `true` or the per-role timeout elapses. Two production shapes cover the bundled M365KG stack:
 *  - {@link tcpConnectProbe} — a raw TCP connect (Postgres/Neo4j/llm-svc: no HTTP health route).
 *  - {@link httpOkProbe}     — a `GET <path>` expecting a 2xx (the backend's `/health`).
 *
 * Mirrors `probes.ts` (`netPortChecker`/`fetchHealthProbe`) — no I/O beyond the single connect/
 * fetch, and every failure resolves `false` (never throws) so the poll loop simply keeps waiting.
 */

import net from "node:net";

/** The loopback endpoint a probe checks — supplied by the supervisor from the child's launch spec. */
export interface ReadinessTarget {
  readonly host: string;
  readonly port: number;
}

/**
 * A bounded readiness check. Resolves `true` once the child is reachable, `false` otherwise. The
 * `signal` bounds a single attempt (the supervisor aborts it after a short per-probe timeout).
 */
export type ReadinessProbe = (target: ReadinessTarget, signal: AbortSignal) => Promise<boolean>;

/** Production TCP-connect probe: `true` when a socket to `host:port` opens cleanly. */
export function tcpConnectProbe(): ReadinessProbe {
  return (target, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve(false);
        return;
      }
      const socket = new net.Socket();
      let settled = false;
      const done = (value: boolean): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        socket.destroy();
        resolve(value);
      };
      const onAbort = (): void => done(false);
      signal.addEventListener("abort", onAbort, { once: true });
      socket.once("error", () => done(false));
      socket.connect(target.port, target.host, () => done(true));
    });
}

/** Production HTTP probe: `true` when `GET http://host:port<path>` returns a 2xx. */
export function httpOkProbe(path: string): ReadinessProbe {
  return async (target, signal) => {
    try {
      const res = await fetch(new URL(path, `http://${target.host}:${target.port}`), {
        method: "GET",
        headers: { accept: "application/json" },
        signal,
      });
      return res.ok;
    } catch {
      return false;
    }
  };
}
