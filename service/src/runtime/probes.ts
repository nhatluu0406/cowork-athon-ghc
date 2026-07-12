/**
 * Injected observation seams for the OpenCode supervisor (CGHC-028 Wave A1).
 *
 * Three narrow ports the default test suite fakes so no live OpenCode / socket / PowerShell is
 * touched, with honest production defaults:
 *  - {@link HealthProbe}        — one `GET /global/health` read (readiness + reported version).
 *  - {@link ProcessTimesProbe}  — the OS process creation-time + exePath for identity capture
 *    (Windows Win32_Process; the single identity source of ADR 0004 LC3).
 *  - {@link PortChecker}        — whether a loopback port is free before spawn.
 */

import net from "node:net";
import { execFile } from "node:child_process";

/** The shape of a `GET /global/health` reply (OpenCode returns `{ healthy, version }`). */
export interface HealthReport {
  readonly healthy: boolean;
  readonly version: string;
}

/** Probe `/global/health` once; resolve `null` (not ready) on any error or non-2xx. */
export type HealthProbe = (baseUrl: string, signal: AbortSignal) => Promise<HealthReport | null>;

/** The live OS process creation-time (ISO) + resolved executable path for a pid. */
export interface ProcessTimes {
  readonly startTime: string;
  readonly exePath: string;
}

/** Read a live pid's creation-time + exePath; resolve `null` when the pid is not live. */
export type ProcessTimesProbe = (pid: number) => Promise<ProcessTimes | null>;

/** Return `true` when `host:port` is free to bind (no listener). */
export type PortChecker = (host: string, port: number) => Promise<boolean>;

/** Production health probe: a single fetch of `/global/health`. */
export function fetchHealthProbe(): HealthProbe {
  return async (baseUrl, signal) => {
    try {
      const res = await fetch(new URL("/global/health", baseUrl), {
        headers: { accept: "application/json" },
        signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { healthy?: unknown; version?: unknown };
      const version = typeof body.version === "string" ? body.version : "";
      // Some pinned builds omit `healthy`; a 2xx with a version string is ready. Only an
      // explicit `healthy: false` keeps us waiting.
      const healthy = body.healthy === undefined ? version.length > 0 : body.healthy === true;
      return { healthy, version };
    } catch {
      return null;
    }
  };
}

/**
 * Production process-times probe (Windows): read CreationDate + ExecutablePath from
 * Win32_Process — the SAME single identity source the lifecycle reaper re-verifies against
 * (ADR 0004). Resolves `null` on a dead pid or when PowerShell/CIM is unavailable.
 */
export function win32ProcessTimesProbe(): ProcessTimesProbe {
  return (pid) =>
    new Promise((resolve) => {
      if (!Number.isInteger(pid) || pid <= 0) {
        resolve(null);
        return;
      }
      const script =
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; ` +
        `if ($null -eq $p) { '' } else { [pscustomobject]@{ ` +
        `startTime = $p.CreationDate.ToUniversalTime().ToString('o'); ` +
        `exePath = $p.ExecutablePath } | ConvertTo-Json -Compress }`;
      execFile(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 20_000 },
        (err, stdout) => {
          if (err) {
            resolve(null);
            return;
          }
          const text = String(stdout).trim();
          if (!text) {
            resolve(null);
            return;
          }
          try {
            const o = JSON.parse(text) as { startTime?: unknown; exePath?: unknown };
            const startTime = typeof o.startTime === "string" ? o.startTime : "";
            const exePath = typeof o.exePath === "string" ? o.exePath : "";
            if (!startTime || Number.isNaN(new Date(startTime).getTime())) {
              resolve(null);
              return;
            }
            resolve({ startTime, exePath });
          } catch {
            resolve(null);
          }
        },
      );
    });
}

/** Production port checker: attempt a throwaway listen; free when it binds cleanly. */
export function netPortChecker(): PortChecker {
  return (host, port) =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, host, () => {
        server.close(() => resolve(true));
      });
    });
}
