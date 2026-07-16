/**
 * LIVE composition entrypoint (CGHC-028 Wave A2) — the Tier 2 wire.
 *
 * Tier 1 `createCoworkService` stays intact for the pure in-process service (tests + the honest
 * not-attached defaults). This entrypoint ADDS a live variant: it takes a started/ready OpenCode
 * supervisor, builds the three LIVE HTTP adapters bound to `supervisor.baseUrl`, and injects them
 * as the four Tier 2 seams so the boundary talks to a real child instead of the reject-everything
 * doubles. It also SEEDS the shared value-based {@link SecretScrubber} with the resolved credential
 * value(s) so `redactError = sanitizeErrorMessage(scrubber.scrub(...))` masks the REAL key even
 * before the shape sanitizer, and it OWNS a single shutdown that stops both the loopback socket and
 * the supervised child.
 *
 * ORDER (why): the adapters read `supervisor.baseUrl` LAZILY per call, so the service is assembled
 * first, the child is started next (making a health round-trip real), the scrubber is seeded, and
 * only then is the loopback socket opened. Shutdown reverses ownership: stop the socket (no new
 * requests) THEN stop the child (ONE owner of the child lifecycle).
 *
 * FIX-6 (value-scrub invariant): the PRODUCTION caller must seed via
 * `deps.credentialService.resolveInjection(...)` (which registers the value with THIS shared
 * scrubber) rather than reading the OS keyring directly, so a short/unshaped custom-endpoint key is
 * value-redacted before any `session.error` EV message can carry it. The supervisor independently
 * injects the key into the child ENV at launch; both paths read the ONE credential store.
 */

import type { RuntimeProcessIdentity } from "@cowork-ghc/runtime";
import type { WorkspaceId } from "@cowork-ghc/contracts";
import type { SecretScrubber } from "../diagnostics/index.js";
import type { RunningService } from "../start.js";
import type { RuntimeHealth } from "../session/index.js";
import type { SupervisorStartSpec } from "../runtime/index.js";
import {
  createEventPump,
  createOpencodeConnector,
  createOpencodeHttp,
  createOpencodeRuntimeReply,
  createOpencodeSendPrompt,
  createOpencodeSessionStore,
  type EventPump,
} from "../runtime/index.js";
import { createCoworkService } from "./compose-service.js";
import type { CoworkServiceDeps, CoworkServiceOptions } from "./types.js";
import { createWorkspaceGuard, grantWorkspace } from "../workspace/index.js";
import { createPermissionBridge } from "../runtime/permission-bridge.js";
import { normalizeOpencodeFramePaths } from "../runtime/opencode-frame-paths.js";
import {
  createPairingRegistry,
  createRemoteRouter,
  isRemoteEnabled,
  lanGatewayUrls,
  resolveRemoteBindHost,
  startRemoteGateway,
  type PairingRegistry,
  type RemoteGateway,
  type RemoteGatewayInfo,
} from "../remote-gateway/index.js";
import {
  createDiscordAdapter,
  createDiscordRestTransport,
  readDiscordConfig,
  type DiscordAdapter,
} from "../remote-gateway/discord/index.js";
import { createLiveBranchRunner } from "../dispatchers/index.js";
import { RuntimeNotAttachedError } from "./tier2-seams.js";

/**
 * The narrow supervisor surface the live wire consumes (satisfied by {@link
 * import("../runtime/index.js").OpencodeSupervisor}). Injectable so tests point a fake at a fake
 * loopback server. Extends {@link RuntimeHealth} so it IS the live `runtimeHealth` seam.
 */
export interface LiveRuntimeSupervisor extends RuntimeHealth {
  start(spec: SupervisorStartSpec): Promise<RuntimeProcessIdentity>;
  stop(): Promise<void>;
  readonly baseUrl: string | null;
}

export interface LiveCoworkServiceOptions {
  /** The child supervisor (Wave A1). Its `isAlive()` becomes the live `runtimeHealth` seam. */
  readonly supervisor: LiveRuntimeSupervisor;
  /** Everything the supervisor needs to launch the one child. */
  readonly startSpec: SupervisorStartSpec;
  /** The single workspace this child serves (its launch `cwd`); stamped on every stored session. */
  readonly workspaceId: WorkspaceId;
  /** Tier 1 bind options + seams (settingsFs, credentialStore, dnsResolver, …). */
  readonly service?: CoworkServiceOptions;
  /** Optional loopback bearer token if the child is configured with auth (default: none). */
  readonly authToken?: string;
  /** Per-request HTTP bound for the adapters (default 15s). */
  readonly requestTimeoutMs?: number;
  /** Injectable fetch (default global). Tests use the real loopback fake server. */
  readonly fetch?: typeof fetch;
  /** Fallback clock for session timestamps + the composition now(). */
  readonly now?: () => string;
  /**
   * Seed the shared value-based scrubber with the resolved credential value(s) so redaction is
   * active over real keys. Production wires this to `deps.credentialService.resolveInjection(...)`
   * (FIX-6). Called after the child is up and before the socket opens.
   */
  readonly seedScrubber?: (scrubber: SecretScrubber, deps: CoworkServiceDeps) => void | Promise<void>;
  /**
   * Env seam for the flag-gated remote gateway (default `process.env`). Unset/off keeps the
   * composition byte-for-byte unchanged (agent-harness-plan.md remote MVP).
   */
  readonly env?: Record<string, string | undefined>;
  /** Secret-free info sink for remote-gateway startup lines (default: stdout). */
  readonly remoteLog?: (line: string) => void;
}

export interface LiveCoworkService {
  readonly running: RunningService;
  readonly deps: CoworkServiceDeps;
  readonly supervisor: LiveRuntimeSupervisor;
  readonly identity: RuntimeProcessIdentity;
  /** The flag-gated remote gateway, present only when `CGHC_REMOTE_ENABLED` is on. */
  readonly remote?: RemoteGateway;
  /** Stop the loopback socket THEN the supervised child (ONE owner). Idempotent-friendly. */
  stop(): Promise<void>;
}

export async function startLiveCoworkService(
  options: LiveCoworkServiceOptions,
): Promise<LiveCoworkService> {
  const { supervisor, startSpec, workspaceId } = options;

  // The adapters read the child base URL lazily, so they can be built before start().
  const http = createOpencodeHttp({
    baseUrl: () => supervisor.baseUrl,
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.authToken !== undefined ? { authToken: options.authToken } : {}),
    ...(options.requestTimeoutMs !== undefined ? { timeoutMs: options.requestTimeoutMs } : {}),
  });
  const sessionStore = createOpencodeSessionStore({
    http,
    workspaceId,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  const runtimeReply = createOpencodeRuntimeReply({ http });
  const connector = createOpencodeConnector({ http });
  // Live prompt-dispatch: POST /session/{id}/message on the child. The EV response streams back
  // out-of-band on `/event` (consumed by the pump below), never in this POST's response.
  const sendPrompt = createOpencodeSendPrompt({ http });

  // Remote feature (flag-gated): ONE pairing registry shared by the desktop `/v1/remote` router
  // and the phone-facing gateway, plus a mutable holder the desktop reads for gateway coordinates
  // (filled after the gateway binds below). When the flag is off, no router is added and the
  // holder stays empty — the baseline composition is unchanged.
  const env = options.env ?? process.env;
  const remoteEnabled = isRemoteEnabled(env);
  const remotePairing: PairingRegistry | undefined = remoteEnabled
    ? createPairingRegistry()
    : undefined;
  let remoteGatewayInfo: RemoteGatewayInfo | null = null;
  const extraRouters =
    remotePairing !== undefined
      ? [
          createRemoteRouter({
            pairing: remotePairing,
            state: {
              enabled: () => remoteGatewayInfo !== null,
              gateway: () => remoteGatewayInfo,
            },
          }),
        ]
      : [];

  // Real dispatch branch runner (Task 5.2 wiring): one fan-out branch = one REAL child session
  // through the SAME session service, prompt seam, and permission gate as the desktop UI. The
  // deps are late-bound: a branch can only run after the service below is assembled, so the
  // closure reading `liveDeps` is safe — and errors honestly if ever hit earlier.
  let liveDeps: CoworkServiceDeps | null = null;
  const requireDeps = (): CoworkServiceDeps => {
    if (liveDeps === null) throw new RuntimeNotAttachedError("dispatch.branch");
    return liveDeps;
  };
  const branchRunner = createLiveBranchRunner({
    createSession: async ({ title }) => {
      const meta = await requireDeps().sessionService.create({ workspaceId, title });
      return { id: meta.id };
    },
    sendPrompt: (sessionId, text) => sendPrompt.send(sessionId, text),
    terminal: (sessionId) => {
      const view = requireDeps().sessionService.view(sessionId);
      if (view === undefined) return undefined;
      if (view.terminal === null) return null;
      return { state: view.terminal };
    },
    cancelSession: (sessionId) => requireDeps().sessionService.cancel(sessionId),
    // Real disk-evidence source for the retry_until_verified hook: the session's authoritative
    // view records every EV `file_mutation` (create/edit/delete/move); dedupe the paths so the
    // hook checks each mutated file once. The hook itself re-confirms on disk — this is only the
    // CLAIM of what to check, never trusted as proof by itself.
    fileMutationPaths: (sessionId) => {
      const view = requireDeps().sessionService.view(sessionId);
      if (view === undefined) return [];
      return [...new Set(view.fileMutations.map((m) => m.path))];
    },
  });

  // Assemble Tier 1 with the LIVE seams filled (not the not-attached defaults).
  const composed = await createCoworkService({
    ...(options.service ?? {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(extraRouters.length > 0 ? { extraRouters } : {}),
    runtimeHealth: supervisor,
    sessionStore,
    runtimeReply,
    connector,
    sendPrompt,
    branchRunner,
  });
  liveDeps = composed.deps;

  const workspaceGrant = grantWorkspace({ rootPath: workspaceId });
  const permissionProxy = composed.deps.buildToolPermissionProxy(createWorkspaceGuard(workspaceGrant));
  const permissionBridge = createPermissionBridge({ proxy: permissionProxy, workspaceRoot: workspaceId });

  async function preprocessFrame(frame: { type: string }): Promise<unknown> {
    const normalized = await normalizeOpencodeFramePaths(frame, workspaceId);
    await permissionBridge.handleFrame(normalized);
    return normalized;
  }

  // Most-recently-active session, tracked as the hub opens runs — the Discord channel's default
  // prompt target (the app owns richer session selection; this is a best-effort MVP default).
  let lastActiveSessionId: string | null = null;

  // The live `/event` → hub pump. It feeds each raw child frame into the session's hub run
  // (the hub owns the single mapper/fold/coalesce/fan-out), so the SSE route has frames to stream.
  const pump: EventPump = createEventPump({
    baseUrl: () => supervisor.baseUrl,
    target: {
      knows: (sessionId) => composed.deps.sessionService.view(sessionId) !== undefined,
      open: (sessionId) => {
        lastActiveSessionId = sessionId;
        return composed.deps.streamHub.open(sessionId);
      },
    },
    redactError: composed.deps.redactError,
    onFrame: preprocessFrame,
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });

  // Bring up the child (real health round-trip), seed the scrubber, open the socket, THEN start
  // the `/event` pump (the child is ready, so `/event` is reachable).
  const identity = await supervisor.start(startSpec);
  try {
    if (options.seedScrubber !== undefined) {
      await options.seedScrubber(composed.deps.scrubber, composed.deps);
    }
    const running = await composed.start();
    pump.start();

    // Flag-gated remote gateway (agent-harness-plan.md remote MVP): started AFTER the main
    // loopback socket so it proxies a live endpoint. A gateway failure must never take the
    // product down — remote is an optional observer, so it degrades to "not available".
    const remoteLog =
      options.remoteLog ?? ((line: string) => process.stdout.write(`${line}\n`));
    let remote: RemoteGateway | undefined;
    if (remotePairing !== undefined) {
      try {
        const remotePort = Number.parseInt(env["CGHC_REMOTE_PORT"] ?? "", 10);
        remote = await startRemoteGateway({
          mainBaseUrl: running.baseUrl,
          mainClientToken: running.clientToken,
          pairing: remotePairing,
          host: resolveRemoteBindHost(env),
          ...(Number.isFinite(remotePort) && remotePort > 0 ? { port: remotePort } : {}),
          log: remoteLog,
        });
        const lanUrls = remote.host === "0.0.0.0" ? lanGatewayUrls(remote.port) : [];
        remoteGatewayInfo = { url: remote.url, lanUrls };
        // The desktop `/remote` panel issues codes + QR via `/v1/remote`; only surface the
        // reachable URL here (never a pairing code or token in a log line).
        remoteLog(`[cowork-remote] gateway san sang: ${remote.url}`);
        for (const url of lanUrls) {
          remoteLog(`[cowork-remote] tu dien thoai (cung Wi-Fi): ${url}`);
        }
        remoteLog(`[cowork-remote] mo /remote trong app de lay ma pairing + QR`);
      } catch (err) {
        remote = undefined;
        remoteGatewayInfo = null;
        remoteLog(
          `[cowork-remote] khong khoi dong duoc gateway: ${err instanceof Error ? err.message : "unknown"}`,
        );
      }
    }

    // Flag-gated Discord channel (agent-harness-plan.md Task 2.3). One poll loop both notifies
    // newly-pending permissions (redacted) and processes inbound commands. Q5: only `deny` and
    // `prompt` reach the gate/session; `approve` of a write is refused inside the adapter.
    const discordConfig = readDiscordConfig(env);
    let discordAdapter: DiscordAdapter | undefined;
    let discordTimer: ReturnType<typeof setInterval> | undefined;
    if (discordConfig !== null) {
      const gate = composed.deps.permissionGate;
      const notified = new Set<string>();
      discordAdapter = createDiscordAdapter({
        transport: createDiscordRestTransport({
          botToken: discordConfig.botToken,
          channelId: discordConfig.channelId,
          log: remoteLog,
        }),
        allowedUserIds: discordConfig.allowedUserIds,
        hooks: {
          listPending: () =>
            gate.pending().map((r) => ({
              requestId: r.requestId,
              description: r.action.description,
              ...(r.action.targetPath !== undefined ? { targetPath: r.action.targetPath } : {}),
            })),
          denyPermission: async (requestId) => {
            const outcome = await gate.resolve({ requestId, decision: "deny" });
            return { status: outcome.status === "resolved" ? "resolved" : outcome.status };
          },
          // MVP: the most recently active session is the prompt target.
          activeSessionId: () => lastActiveSessionId,
          sendPrompt: async (sessionId, text) => {
            try {
              await sendPrompt.send(sessionId, text);
              return { accepted: true };
            } catch (e) {
              const reason =
                typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string"
                  ? ((e as { code: string }).code)
                  : "error";
              return { accepted: false, reason };
            }
          },
        },
      });
      const adapter = discordAdapter;
      discordTimer = setInterval(() => {
        // Notify any newly-pending permission (once each), then process inbound commands.
        for (const r of gate.pending()) {
          if (notified.has(r.requestId)) continue;
          notified.add(r.requestId);
          void adapter.notifyPermissionAsked({
            requestId: r.requestId,
            description: r.action.description,
            ...(r.action.targetPath !== undefined ? { targetPath: r.action.targetPath } : {}),
          });
        }
        void adapter.pump();
      }, 4000);
      discordTimer.unref?.();
      remoteLog(`[cowork-remote] Discord channel bat (allowlist ${discordConfig.allowedUserIds.length} user)`);
    }

    return {
      running,
      deps: composed.deps,
      supervisor,
      identity,
      ...(remote !== undefined ? { remote } : {}),
      // Ordered teardown (ONE owner): stop the remote gateway (it depends on the socket) →
      // stop the socket (no new requests) → stop the pump (close the `/event` consumer) →
      // stop the child. The pump reads FROM the child, so it must be torn down before the
      // child is killed. Each step is protected so a later step always runs.
      stop: async (): Promise<void> => {
        try {
          if (discordTimer !== undefined) clearInterval(discordTimer);
          remoteGatewayInfo = null;
          await remote?.stop().catch(() => undefined);
        } finally {
          try {
            await running.service.stop();
          } finally {
            try {
              await pump.stop();
            } finally {
              permissionBridge.reset();
              await supervisor.stop();
            }
          }
        }
      },
    };
  } catch (err) {
    // Never leak a started child (or a running pump) if the socket/seed failed after start().
    await pump.stop().catch(() => undefined);
    await supervisor.stop().catch(() => undefined);
    throw err;
  }
}
