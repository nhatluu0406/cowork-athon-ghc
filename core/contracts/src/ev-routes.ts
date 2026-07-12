/**
 * EV two-hop SSE route paths — shared protocol constants (CGHC-015 security co-sign, LOW-S5).
 *
 * The renderer client, the live-stream route, and the snapshot/resync route MUST agree on the
 * same URL paths. Previously each side re-declared the literal string, so a change in one place
 * could silently diverge. Centralizing them here (the shell-neutral, runtime-free contracts
 * barrel) gives ONE source of truth that every surface — service AND `app/ui` — imports.
 *
 * These are stable wire paths, not user-facing text; they stay in English (identifier rule).
 */

/** `GET` — authoritative folded snapshot + resume cursor (hop-1 resync). Token-guarded. */
export const EV_SNAPSHOT_PATH = "/v1/session/stream/snapshot";

/** `GET` — long-lived live EV SSE stream resumed from `sinceSeq` (hop-2). Token-guarded. */
export const EV_STREAM_PATH = "/v1/session/stream";
