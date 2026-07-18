import type { CredentialRef } from "@cowork-ghc/contracts";
import type { GatewayStore } from "./gateway-store.js";
import {
  DEFAULT_GATEWAY_PROXY_PORT,
  getGatewayProxyBaseUrl,
  isGatewayProxyUrl,
} from "./gateway-proxy-url.js";
import type { ProxyUpstream } from "./proxy-server.js";
import type {
  AddAccountInput,
  GatewayAccount,
  GatewayAccountView,
  GatewayRequestLogEntry,
  GatewayStatus,
  LinkAccountInput,
  RecordRequestInput,
} from "./types.js";

export type { ProxyUpstream };

export interface GatewayService {
  listAccounts(): readonly GatewayAccount[];
  addAccount(input: AddAccountInput): Promise<GatewayAccount>;
  linkAccount(input: LinkAccountInput): Promise<GatewayAccount>;
  removeAccount(id: string): Promise<void>;
  activateAccount(id: string): Promise<void>;
  getStatus(): GatewayStatus;
  /** Master switch: true once the operator has opted into system-wide gateway enforcement. */
  isEnabled(): boolean;
  setEnabled(enabled: boolean): Promise<void>;
  /** Append one row to the request log (called once per session-create attempt). */
  recordRequest(input: RecordRequestInput): Promise<void>;
  /** Newest-first, capped history. */
  listLogs(): readonly GatewayRequestLogEntry[];
  /**
   * Re-read `gateway.json` from disk. Tier 1 (settings-only) and Tier 2 (live) each hold their
   * own `GatewayService`/`GatewayStore` — a chat send is gated/logged by whichever is live, but
   * a passive read (status/logs) can land on the OTHER tier's stale in-memory copy. Call this
   * before any read the UI depends on being current; skip it around a just-performed local
   * mutation (that in-memory state is already the freshest there is).
   */
  refreshFromDisk(): Promise<void>;
  /**
   * The real upstream the Gateway proxy should forward the CURRENT in-flight request to — the
   * proxy calls this per-request. Undefined when the gateway is off, or no linked profile has
   * an active account, meaning the proxy responds 503 rather than guessing a destination.
   */
  resolveProxyUpstream(): ProxyUpstream | undefined;
  /**
   * The user-configured Gateway proxy port (default {@link DEFAULT_GATEWAY_PROXY_PORT} until
   * changed). Takes effect on the NEXT app restart — the running proxy already bound its port at
   * composition time (see `compose-service.ts`'s `gatewayProxyPort` seam).
   */
  getConfiguredPort(): number;
  setConfiguredPort(port: number): Promise<void>;
}

export interface GatewayServiceOptions {
  readonly store: GatewayStore;
  readonly storeCredential: (account: string, key: string) => Promise<CredentialRef>;
  readonly removeCredential: (ref: CredentialRef) => Promise<void>;
  readonly hasCredential: (ref: CredentialRef) => Promise<boolean>;
  readonly generateId: () => string;
  readonly now: () => string;
  /** Current `baseUrl` of a provider profile (undefined if the profile doesn't exist). */
  readonly getProfileBaseUrl: (profileId: string) => string | undefined;
  /** Persist a new `baseUrl` for a provider profile (Settings → Nhà cung cấp is the store). */
  readonly setProfileBaseUrl: (profileId: string, baseUrl: string) => Promise<void>;
  /** The profile id currently driving chat, if any — used to pick the proxy's forward target. */
  readonly getActiveProfileId: () => string | undefined;
  /** True once the Gateway's real HTTP proxy has actually bound its port this session. */
  readonly isProxyAvailable: () => boolean;
}

/** Thrown by `setEnabled(true)` when the proxy server never bound — surfaced to the UI as-is. */
export class GatewayProxyUnavailableError extends Error {
  constructor() {
    super(
      "Gateway proxy server không khả dụng — không thể bật Gateway. Kiểm tra lại cổng server ở tab Gateway.",
    );
    this.name = "GatewayProxyUnavailableError";
  }
}

export function createGatewayService(options: GatewayServiceOptions): GatewayService {
  const {
    store,
    storeCredential,
    removeCredential,
    hasCredential,
    generateId,
    now,
    getProfileBaseUrl,
    setProfileBaseUrl,
    getActiveProfileId,
    isProxyAvailable,
  } = options;

  /** Point `profileId`'s Settings baseUrl at the local proxy, remembering the real one first. */
  async function routeProfileThroughGateway(account: GatewayAccount): Promise<GatewayAccount> {
    if (account.upstreamBaseUrl !== undefined) return account; // already swapped
    const proxyBaseUrl = getGatewayProxyBaseUrl();
    const currentBaseUrl = getProfileBaseUrl(account.providerId);
    if (currentBaseUrl === undefined || isGatewayProxyUrl(currentBaseUrl)) return account;
    const updated: GatewayAccount = {
      ...account,
      upstreamBaseUrl: currentBaseUrl,
      lastKnownUpstreamBaseUrl: currentBaseUrl,
    };
    store.saveAccount(updated);
    await setProfileBaseUrl(account.providerId, proxyBaseUrl);
    return updated;
  }

  /** Restore `profileId`'s Settings baseUrl to the real endpoint saved before the swap. */
  async function restoreProfileFromGateway(account: GatewayAccount): Promise<GatewayAccount> {
    if (account.upstreamBaseUrl === undefined) return account;
    await setProfileBaseUrl(account.providerId, account.upstreamBaseUrl);
    // `exactOptionalPropertyTypes` forbids assigning `undefined` to an optional field — omit
    // the key entirely (rest-destructure it away) rather than set it to undefined.
    const { upstreamBaseUrl: _dropped, ...rest } = account;
    const updated: GatewayAccount = rest;
    store.saveAccount(updated);
    return updated;
  }

  return {
    listAccounts(): readonly GatewayAccount[] {
      return store.listAccounts();
    },

    async addAccount(input: AddAccountInput): Promise<GatewayAccount> {
      const { providerId, label, apiKey } = input;
      if (typeof providerId !== "string" || providerId.trim().length === 0) {
        throw new Error("providerId is required.");
      }
      if (typeof label !== "string" || label.trim().length === 0) {
        throw new Error("label is required.");
      }
      if (typeof apiKey !== "string" || apiKey.length === 0) {
        throw new Error("apiKey is required.");
      }
      const id = generateId();
      const credentialRef = await storeCredential(`gateway:${id}`, apiKey);
      const account: GatewayAccount = {
        id,
        providerId,
        label,
        credentialRef,
        addedAt: now(),
        linked: false,
      };
      store.saveAccount(account);
      await store.flush();
      return account;
    },

    async linkAccount(input: LinkAccountInput): Promise<GatewayAccount> {
      const { providerId, label, credentialAccount } = input;
      if (typeof providerId !== "string" || providerId.trim().length === 0) {
        throw new Error("providerId is required.");
      }
      if (typeof label !== "string" || label.trim().length === 0) {
        throw new Error("label is required.");
      }
      if (typeof credentialAccount !== "string" || credentialAccount.trim().length === 0) {
        throw new Error("credentialAccount is required.");
      }
      const credentialRef: CredentialRef = { store: "os", account: credentialAccount };
      if (!(await hasCredential(credentialRef))) {
        throw new Error("The selected saved key could not be found. Re-check it in Settings.");
      }
      const id = generateId();
      // The checklist maps one profile to one linked account 1:1, so ticking it on both creates
      // AND activates the account in a single step (see `setActiveAccount` below) — no separate
      // activation click. `isActive` itself is presentation-only (`GatewayAccountView`, derived
      // fresh in `getStatus`) — never stored here.
      let account: GatewayAccount = {
        id,
        providerId,
        label,
        credentialRef,
        addedAt: now(),
        linked: true,
      };
      store.saveAccount(account);
      store.setActiveAccount(providerId, id);
      // The master switch may already be ON when a NEW profile is ticked in the checklist —
      // route it through the proxy immediately rather than waiting for the next toggle.
      if (store.isEnabled()) {
        account = await routeProfileThroughGateway(account);
      }
      await store.flush();
      return account;
    },

    async removeAccount(id: string): Promise<void> {
      const accounts = store.listAccounts();
      const account = accounts.find((a) => a.id === id);
      if (account === undefined) {
        throw new Error(`Gateway account not found: ${id}`);
      }
      // Restore the profile's real baseUrl BEFORE deleting — otherwise it stays pointed at the
      // proxy forever with no gateway account left to resolve an upstream for it.
      await restoreProfileFromGateway(account);
      // Linked accounts reuse a credential owned by Settings — never delete it here.
      if (!account.linked) {
        await removeCredential(account.credentialRef);
      }
      store.deleteAccount(id);
      await store.flush();
    },

    async activateAccount(id: string): Promise<void> {
      const accounts = store.listAccounts();
      const account = accounts.find((a) => a.id === id);
      if (account === undefined) {
        throw new Error(`Gateway account not found: ${id}`);
      }
      store.setActiveAccount(account.providerId, id);
      await store.flush();
    },

    getStatus(): GatewayStatus {
      const stored = store.listAccounts();
      const activeByProvider: Record<string, string> = {};
      for (const account of stored) {
        const activeId = store.getActiveAccountId(account.providerId);
        if (activeId !== undefined) {
          activeByProvider[account.providerId] = activeId;
        }
      }
      // `isActive` is a view-only field, computed fresh every read (never stored) — activating a
      // second account for the same provider must instantly demote the first, which a persisted
      // flag could never guarantee.
      const accounts: GatewayAccountView[] = stored.map((a) => ({
        ...a,
        isActive: activeByProvider[a.providerId] === a.id,
      }));
      // Master switch OFF (the shipped default) takes precedence: the gateway is pure bookkeeping
      // then — no traffic is observed, logged, or routed — so it must never claim "healthy". Only
      // once ON do proxy availability and account count decide the real health. Proxy unavailable
      // overrides account count: a linked account is meaningless if there is nowhere for its
      // traffic to be forwarded (the `serverWarning` banner in the UI shows the same signal — this
      // badge must never contradict it by reporting "healthy" underneath).
      const health: GatewayStatus["health"] = !store.isEnabled()
        ? "off"
        : !isProxyAvailable()
          ? "down"
          : accounts.length > 0
            ? "healthy"
            : "unknown";
      return {
        health,
        accounts,
        activeByProvider,
        enabled: store.isEnabled(),
        serverAddress: getGatewayProxyBaseUrl(),
        proxyAvailable: isProxyAvailable(),
        configuredPort: store.getServerPort() ?? DEFAULT_GATEWAY_PROXY_PORT,
      };
    },

    isEnabled(): boolean {
      return store.isEnabled();
    },

    async setEnabled(enabled: boolean): Promise<void> {
      // "trường hợp server không khả dụng thì không thể ON được" — refuse the switch outright
      // rather than silently swapping profiles to an address nothing is listening on.
      if (enabled && !isProxyAvailable()) {
        throw new GatewayProxyUnavailableError();
      }
      // Flip every LINKED account's profile between the real endpoint and the local proxy —
      // this is the actual traffic-routing switch, not just a flag. An account added via the
      // manual (non-linked) path has no Settings profile to redirect, so it's left alone.
      for (const account of store.listAccounts().filter((a) => a.linked)) {
        if (enabled) {
          await routeProfileThroughGateway(account);
        } else {
          await restoreProfileFromGateway(account);
        }
      }
      store.setEnabled(enabled);
      await store.flush();
    },

    resolveProxyUpstream(): ProxyUpstream | undefined {
      // Deliberately NOT gated on `store.isEnabled()`. OpenCode only reads `opencode.json` at
      // spawn (see `runtime/opencode-config.ts`), so flipping the master switch OFF does not
      // retarget an ALREADY-RUNNING child away from the proxy until the next restart — it keeps
      // sending here regardless of the switch. Blocking those requests here (as a prior version
      // did, via `outcome: "blocked", reason: "no_active_account"`) broke the OFF contract
      // ("hoạt động bình thường" — works normally, no restart required): the very first message
      // sent after turning OFF would hard-fail instead of just going straight to the real
      // provider. Any account whose real upstream is on file (`upstreamBaseUrl`, saved at swap
      // time) is forwarded to unconditionally — the switch only controls whether NEW swaps
      // happen (see `setEnabled`/`linkAccount`), never whether in-flight traffic is let through.
      // Reads `lastKnownUpstreamBaseUrl` (never cleared by `restoreProfileFromGateway`) rather
      // than `upstreamBaseUrl` (cleared on restore) precisely so a stale, still-proxy-pointed
      // request keeps working right after the switch flips OFF, not just while it reads ON.
      const profileId = getActiveProfileId();
      if (profileId === undefined) return undefined;
      const activeId = store.getActiveAccountId(profileId);
      if (activeId === undefined) return undefined;
      const account = store.listAccounts().find((a) => a.id === activeId);
      const upstreamBaseUrl = account?.lastKnownUpstreamBaseUrl ?? account?.upstreamBaseUrl;
      if (upstreamBaseUrl === undefined) return undefined;
      return { baseUrl: upstreamBaseUrl };
    },

    getConfiguredPort(): number {
      return store.getServerPort() ?? DEFAULT_GATEWAY_PROXY_PORT;
    },

    async setConfiguredPort(port: number): Promise<void> {
      store.setServerPort(port); // throws for an out-of-range value; never persists a bad one
      // Real incident (2026-07-18): a profile swapped to the OLD port keeps that stale address
      // in Settings — this session's proxy stays bound to the old port regardless (it only
      // reads `gatewayProxyPort` once, at composition time), so the swap is harmless for NOW,
      // but it becomes a dangling `http://127.0.0.1:<old-port>/v1` the moment the NEW port takes
      // over at the next restart: `isGatewayProxyUrl` will no longer recognize it (the default
      // moves to the new port), and the SSRF policy legitimately refuses it — bricking the live
      // tier exactly like the 2026-07-17 incident this whole fixed-port design exists to prevent.
      // Restoring every swap now (and forcing the switch OFF) is the only way to guarantee no
      // stale port ever reaches Settings; the user re-enables after restart, which swaps fresh
      // against the new port.
      for (const account of store.listAccounts().filter((a) => a.linked)) {
        await restoreProfileFromGateway(account);
      }
      store.setEnabled(false);
      await store.flush();
    },

    async recordRequest(input: RecordRequestInput): Promise<void> {
      // Privacy (#38): the request log records only routing metrics (model/outcome/status/timing),
      // never the user's prompt text — that lives solely in the conversation store.
      const entry: GatewayRequestLogEntry = {
        id: generateId(),
        at: now(),
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.profileId !== undefined ? { profileId: input.profileId } : {}),
        ...(input.profileLabel !== undefined ? { profileLabel: input.profileLabel } : {}),
        ...(input.accountId !== undefined ? { accountId: input.accountId } : {}),
        gatewayEnabled: input.gatewayEnabled,
        outcome: input.outcome,
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
        ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
        ...(input.providerType !== undefined ? { providerType: input.providerType } : {}),
        ...(input.httpStatus !== undefined ? { httpStatus: input.httpStatus } : {}),
        ...(input.ttfbMs !== undefined ? { ttfbMs: input.ttfbMs } : {}),
        ...(input.totalMs !== undefined ? { totalMs: input.totalMs } : {}),
      };
      store.appendLog(entry);
      await store.flush();
    },

    listLogs(): readonly GatewayRequestLogEntry[] {
      return store.listLogs();
    },

    async refreshFromDisk(): Promise<void> {
      await store.reload();
    },
  };
}
