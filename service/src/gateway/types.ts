import type { CredentialRef } from "@cowork-ghc/contracts";

export type GatewayHealth = "unknown" | "healthy" | "degraded" | "down";

export interface GatewayAccount {
  readonly id: string;
  readonly providerId: string;
  readonly label: string;
  readonly credentialRef: CredentialRef;
  readonly addedAt: string;
  /**
   * True when this account reuses a credential owned by something else (e.g. a Settings
   * provider profile) rather than a key the gateway stored itself. Removing a linked account
   * must NEVER delete the underlying credential — only accounts added via `addAccount` own
   * their credential and are safe to delete.
   */
  readonly linked: boolean;
  /**
   * The provider profile's REAL upstream `baseUrl`, saved the moment the Gateway master switch
   * turns ON (before the profile's own `baseUrl` gets swapped to point at the local proxy).
   * Cleared (restored to the profile verbatim) when the switch turns OFF — `undefined` means
   * "not currently swapped." Used by `routeProfileThroughGateway`'s already-swapped shortcut.
   */
  readonly upstreamBaseUrl?: string;
  /**
   * Same value as {@link upstreamBaseUrl} at the moment of the most recent swap, but NEVER
   * cleared on restore. OpenCode only re-reads `opencode.json` at spawn (see
   * `runtime/opencode-config.ts`), so turning the switch OFF does not retarget an
   * already-running child away from the proxy until the next restart — it keeps sending
   * requests here in the meantime. `resolveProxyUpstream` needs a real destination for that
   * in-flight traffic even after `upstreamBaseUrl` above has been cleared; this field is that
   * memory. Undefined until the switch has been turned on at least once while this account existed.
   */
  readonly lastKnownUpstreamBaseUrl?: string;
}

/**
 * A {@link GatewayAccount} plus the ONE presentation-only field derived fresh on every read.
 * `isActive` is never persisted on the stored account — trusting a stored copy would go stale
 * the instant a second account for the same `providerId` is activated (see `getStatus`).
 */
export interface GatewayAccountView extends GatewayAccount {
  readonly isActive: boolean;
}

export interface GatewayStatus {
  readonly health: GatewayHealth;
  readonly accounts: readonly GatewayAccountView[];
  readonly activeByProvider: Readonly<Record<string, string>>; // providerId → accountId
  /**
   * Master switch. OFF (default): the gateway is pure bookkeeping — Settings → Nhà cung cấp
   * drives every provider call exactly as before, and traffic is never observed/logged. ON:
   * every linked profile's `baseUrl` is swapped to the local proxy (`routeProfileThroughGateway`),
   * so its traffic physically flows through the proxy and gets logged there — enforcement and
   * logging both live in `gateway/proxy-server.ts` now, not a session-boundary check.
   */
  readonly enabled: boolean;
  /** The Gateway proxy's ACTUAL bound loopback address this session (e.g. `http://127.0.0.1:47771/v1`). */
  readonly serverAddress: string;
  /**
   * True when the Gateway's real HTTP proxy actually bound its port this session. False means
   * the master switch cannot be turned ON (see `setEnabled`) — traffic would have nowhere to go.
   */
  readonly proxyAvailable: boolean;
  /**
   * The user-SAVED port setting (default {@link import("./gateway-proxy-url.js").DEFAULT_GATEWAY_PROXY_PORT}).
   * May differ from the port embedded in `serverAddress` right after the user changes it — the
   * change only takes effect on the NEXT app restart (same rule as the master toggle).
   */
  readonly configuredPort: number;
}

export interface AddAccountInput {
  readonly providerId: string;
  readonly label: string;
  readonly apiKey: string;
}

/**
 * Link an already-stored credential (e.g. from a Settings → Provider profile) to the gateway
 * instead of re-entering the raw key. `credentialAccount` is the non-secret OS-keyring account
 * name already exposed to the renderer via `ProviderProfileView.credentialAccount`.
 */
export interface LinkAccountInput {
  readonly providerId: string;
  readonly label: string;
  readonly credentialAccount: string;
}

export type GatewayRequestOutcome = "allowed" | "blocked";

/** One row recorded each time a prompt is actually dispatched (every chat send, not just create). */
export interface GatewayRequestLogEntry {
  readonly id: string;
  readonly at: string;
  readonly sessionId?: string;
  readonly profileId?: string;
  readonly profileLabel?: string;
  readonly accountId?: string;
  readonly gatewayEnabled: boolean;
  readonly outcome: GatewayRequestOutcome;
  readonly reason?: string;
  /**
   * The user's own prompt text, truncated (see `PROMPT_PREVIEW_MAX_CHARS` in
   * gateway-service.ts) and PII-masked (see `maskPii`) — never the assistant's reply, never
   * tool output. This is the same user-visible content already stored in the conversation
   * transcript, not a secret, but emails/phone-like/card-like numbers are still redacted.
   */
  readonly promptPreview?: string;
  /** e.g. "DeepSeek-V4-Flash" — the profile's configured model at request time. */
  readonly modelId?: string;
  /** e.g. "deepseek" | "custom-openai-compat" — the profile's provider type. */
  readonly providerType?: string;
  /** REAL metrics captured by the proxy — present only for requests that actually flowed through it. */
  readonly httpStatus?: number;
  readonly ttfbMs?: number;
  readonly totalMs?: number;
}

export interface RecordRequestInput {
  readonly sessionId?: string;
  readonly profileId?: string;
  readonly profileLabel?: string;
  readonly accountId?: string;
  readonly gatewayEnabled: boolean;
  readonly outcome: GatewayRequestOutcome;
  readonly reason?: string;
  readonly promptPreview?: string;
  readonly modelId?: string;
  readonly providerType?: string;
  readonly httpStatus?: number;
  readonly ttfbMs?: number;
  readonly totalMs?: number;
}
