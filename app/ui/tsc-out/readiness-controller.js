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
import { sanitizeErrorMessage } from "@cowork-ghc/service/execution";
import { ServiceClientError } from "./service-client.js";
const DEFAULT_BACKOFF = { baseMs: 500, factor: 2, maxMs: 8000 };
const NOT_CONNECTED_MSG = "Chưa nhận được cấu hình kết nối từ shell.";
/** Classify a probe failure into non-secret, user-facing copy (never a raw stack). */
function classify(error) {
    if (error instanceof ServiceClientError && error.code === "protocol_mismatch") {
        return { code: "protocol_mismatch", message: "Sai phiên bản giao thức giữa app và service." };
    }
    const code = error instanceof ServiceClientError ? error.code : "unreachable";
    return { code, message: "Không kết nối được local service (service có thể chưa chạy)." };
}
/** Scrubbed diagnostics detail — sanitized so no stack frame / secret ever reaches the DOM. */
function detailOf(error) {
    return error instanceof Error ? sanitizeErrorMessage(error.message) : "Lỗi không xác định.";
}
export function createReadinessController(deps) {
    const backoff = { ...DEFAULT_BACKOFF, ...deps.backoff };
    const setTimeoutFn = deps.timer?.setTimeout.bind(deps.timer) ?? ((h, ms) => setTimeout(h, ms));
    const clearTimeoutFn = deps.timer?.clearTimeout.bind(deps.timer) ??
        ((h) => clearTimeout(h));
    let client = null;
    let pendingTimer = null;
    let attempt = 0; // health-probe attempts (display)
    let failures = 0; // consecutive failures (backoff exponent)
    let started = false;
    let disposed = false;
    let inFlight = false;
    const emit = (state) => deps.onState(state);
    const clearPending = () => {
        if (pendingTimer !== null) {
            clearTimeoutFn(pendingTimer);
            pendingTimer = null;
        }
    };
    const schedule = () => {
        if (disposed)
            return;
        clearPending();
        const delay = Math.min(backoff.baseMs * backoff.factor ** Math.min(failures, 16), backoff.maxMs);
        pendingTimer = setTimeoutFn(() => {
            pendingTimer = null;
            void probe();
        }, delay);
    };
    async function probe() {
        if (disposed || inFlight)
            return;
        inFlight = true;
        try {
            if (client === null) {
                emit({ phase: "starting" });
                let bootstrap;
                try {
                    bootstrap = await deps.getBootstrap();
                }
                catch (error) {
                    if (disposed)
                        return;
                    failures += 1;
                    emit({ phase: "not_connected", message: NOT_CONNECTED_MSG, detail: detailOf(error) });
                    schedule();
                    return;
                }
                if (disposed)
                    return;
                if (!bootstrap.serviceBaseUrl || !bootstrap.clientToken) {
                    failures += 1;
                    emit({
                        phase: "not_connected",
                        message: NOT_CONNECTED_MSG,
                        detail: "Shell chưa cung cấp base URL hoặc token.",
                    });
                    schedule();
                    return;
                }
                client = deps.createClient(bootstrap.serviceBaseUrl, bootstrap.clientToken);
            }
            attempt += 1;
            emit({ phase: "connecting", attempt });
            let health;
            try {
                health = await client.health();
            }
            catch (error) {
                if (disposed)
                    return;
                failures += 1;
                const { code, message } = classify(error);
                emit({ phase: "unreachable", code, message, detail: detailOf(error), attempt });
                schedule();
                return;
            }
            if (disposed)
                return;
            failures = 0;
            // Polling STOPS here: a real successful health response is the only route to `ready`.
            emit({ phase: "ready", health });
        }
        finally {
            inFlight = false;
        }
    }
    return {
        start: () => {
            if (started)
                return;
            started = true;
            disposed = false;
            void probe();
        },
        retry: () => {
            if (disposed)
                return;
            clearPending();
            failures = 0;
            attempt = 0;
            client = null; // re-request the handshake, then re-probe from scratch
            void probe();
        },
        stop: () => {
            disposed = true;
            started = false;
            clearPending();
        },
    };
}
//# sourceMappingURL=readiness-controller.js.map