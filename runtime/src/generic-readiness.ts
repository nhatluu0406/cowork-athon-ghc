/**
 * Readiness probes for verifying that a subprocess is ready to accept connections.
 *
 * Probes: HTTP OK (GET /health), TCP connect, etc. Used by GenericChildSupervisor
 * to wait for services (Postgres, Neo4j, backend) to be ready before proceeding.
 *
 * NOTE: D3 Knowledge integration is PARTIAL (not merge-ready). This module
 * is a stub implementation for compilation; full functionality pending.
 */

/**
 * A readiness probe function that returns true if the service is ready,
 * or throws/returns false if not ready.
 */
export type ReadinessProbe = () => Promise<boolean>;

/**
 * HTTP readiness probe: sends GET to /health and expects 2xx status.
 * @param baseUrl - The base URL (e.g., "http://127.0.0.1:8080")
 * @returns A probe function that checks HTTP /health endpoint
 *
 * STUB: returns a function that always resolves to true (pending D3 merge).
 */
export function httpOkProbe(baseUrl: string): ReadinessProbe {
  return async () => {
    // Stub: actual implementation pending D3 merge
    // In production: fetch GET ${baseUrl}/health, check status in [200, 299]
    return true;
  };
}

/**
 * TCP readiness probe: attempts to connect to a host:port.
 * @param host - Hostname or IP (e.g., "127.0.0.1")
 * @param port - Port number (e.g., 5432 for Postgres)
 * @returns A probe function that tests TCP connectivity
 *
 * STUB: returns a function that always resolves to true (pending D3 merge).
 */
export function tcpConnectProbe(host: string, port: number): ReadinessProbe {
  return async () => {
    // Stub: actual implementation pending D3 merge
    // In production: attempt socket connection, check for immediate connect or ECONNREFUSED
    return true;
  };
}

/**
 * Executes a readiness probe repeatedly until success or timeout.
 *
 * @param probe - The probe function to execute
 * @param maxWaitMs - Maximum time to wait (default: 30000ms)
 * @param intervalMs - Interval between retries (default: 500ms)
 * @returns Promise resolves when probe succeeds; rejects if timeout
 *
 * STUB: always resolves immediately (pending D3 merge).
 */
export async function waitUntilReady(
  probe: ReadinessProbe,
  maxWaitMs = 30000,
  intervalMs = 500
): Promise<void> {
  // Stub: actual implementation pending D3 merge
  // In production: loop calling probe(), wait intervalMs between attempts, timeout after maxWaitMs
  const result = await probe();
  if (!result) {
    throw new Error("Readiness probe failed");
  }
}
