/**
 * Progressive readiness controller (CGHC-025 cold-start hardening, renderer half).
 *
 * Owns ALL boot business logic so the view stays a pure render (frontend.md): the shell
 * handshake, becoming a client of the loopback service, and POLLING `health()` with bounded
 * backoff. It reflects the TRUE boot phase and NEVER fabricates a "ready" state — `ready` is
 * emitted only after a real successful `health()` response (the EV7 honesty rule applied to
 * boot). A crashed / unreachable / drifted service stays in an honest error phase that the
 * view pairs with a Retry + View-diagnostics recovery affordance.
 *
 * It is NOT the live process supervisor: spawning the service + OpenCode child and doing real
 * crash detection / restart is Tier-2 (CGHC-028). Here we render only what `health()` truthfully
 * reports and leave a clearly-labelled runtime slot rather than inventing a runtime-up state.
 *
 * Every side-effecting seam is injectable (bootstrap source, client factory, timer, backoff) so
 * tests drive the whole lifecycle with no real time and no real socket.
 */
import type { RendererBootstrap } from "@cowork-ghc/contracts";
import { type ServiceHealth } from "./service-client.js";
/** Honest boot phases. `ready` is reachable ONLY via a real successful `health()`. */
export type ReadinessState = {
    readonly phase: "starting";
} | {
    readonly phase: "not_connected";
    readonly message: string;
    readonly detail: string;
} | {
    readonly phase: "connecting";
    readonly attempt: number;
} | {
    readonly phase: "ready";
    readonly health: ServiceHealth;
} | {
    readonly phase: "unreachable";
    readonly code: string;
    readonly message: string;
    readonly detail: string;
    readonly attempt: number;
};
/** Just the health probe — the only method the controller needs from the service client. */
export type ReadinessHealthClient = {
    health(): Promise<ServiceHealth>;
};
/** Injectable timer seam (setTimeout-based backoff). Tests supply a fake; no real waits. */
export interface ReadinessTimer {
    setTimeout(handler: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}
/** Bounded backoff config. Delay is capped at `maxMs`, so auto-retry can never runaway. */
export interface ReadinessBackoff {
    readonly baseMs: number;
    readonly factor: number;
    readonly maxMs: number;
}
export interface ReadinessControllerDeps {
    /** Request the one-shot shell handshake (loopback base URL + per-launch token). */
    getBootstrap(): Promise<RendererBootstrap>;
    /** Build a health client from the handshake. Kept a factory so tests inject a fake. */
    createClient(baseUrl: string, clientToken: string): ReadinessHealthClient;
    /** Receive every phase transition (the view renders it). */
    onState(state: ReadinessState): void;
    timer?: ReadinessTimer;
    backoff?: Partial<ReadinessBackoff>;
}
export interface ReadinessControllerHandle {
    /** Begin the handshake + polling lifecycle. Idempotent. */
    start(): void;
    /** Recovery: reset backoff, re-request the handshake, and re-probe immediately. */
    retry(): void;
    /** Teardown: stop all polling and clear any pending timer (no leaks). */
    stop(): void;
}
export declare function createReadinessController(deps: ReadinessControllerDeps): ReadinessControllerHandle;
//# sourceMappingURL=readiness-controller.d.ts.map