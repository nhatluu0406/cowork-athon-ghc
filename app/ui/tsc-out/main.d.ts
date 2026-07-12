/**
 * Renderer entry.
 *
 * Drives a PROGRESSIVE, honest cold-start (CGHC-025): the readiness controller owns the shell
 * handshake and health polling with bounded backoff, and the readiness view reflects the true
 * boot phase (starting → connecting → ready, or an honest not_connected / unreachable with Retry
 * + diagnostics). Nothing is ever a fabricated "ready" — the feature views mount ONLY after a real
 * successful `health()`. No business logic, no filesystem/credential access, no secret in the DOM.
 * The live multi-process supervisor (spawn + crash/restart) is Tier-2 (CGHC-028).
 */
export {};
//# sourceMappingURL=main.d.ts.map