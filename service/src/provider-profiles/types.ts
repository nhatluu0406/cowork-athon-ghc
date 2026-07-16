/**
 * Multi-Provider Profiles Phase 1 — application-layer profile model.
 *
 * Secret discipline: persisted profiles carry a {@link CredentialRef} HANDLE only.
 * API keys never appear in JSON, transcripts, logs, or renderer state.
 */

import type { CredentialRef } from "@cowork-ghc/contracts";

/** Phase 1 provider kinds exposed to users (not raw adapter ids). */
export type ProviderProfileType = "deepseek" | "fptcloud" | "custom-openai-compat";

/** Optional preset metadata for factory-created profiles. */
export interface ProviderProfilePresetMeta {
  readonly presetId: string;
}

/** A saved provider profile (secret-free except credential handle). */
export interface ProviderProfile {
  readonly id: string;
  readonly displayName: string;
  readonly providerType: ProviderProfileType;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly envVar: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly credentialRef?: CredentialRef;
  readonly preset?: ProviderProfilePresetMeta;
  readonly credentialRevision?: number;
  readonly lastVerifiedAt?: string;
  readonly lastVerifiedOk?: boolean;
  readonly verifiedTargetFingerprint?: string;
}

/** Non-secret profile row returned to the renderer. */
export interface ProviderProfileView {
  readonly id: string;
  readonly displayName: string;
  readonly providerType: ProviderProfileType;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly credentialConfigured: boolean;
  readonly credentialAccount?: string;
  readonly presetId?: string;
  readonly isActive: boolean;
  /** True when last verification matches the current endpoint/model/credential revision. */
  readonly verificationCurrent: boolean;
  readonly lastVerifiedAt?: string;
  readonly lastVerifiedOk?: boolean;
}

/** Provider/model identity snapshotted on a conversation's first turn. */
export interface ConversationProviderSnapshot {
  readonly profileId: string;
  readonly displayName: string;
  readonly providerType: ProviderProfileType;
  readonly modelId: string;
  readonly baseUrl: string;
}

/** Per-profile connection test outcome (isolated by profile id). */
export interface ProfileConnectionTestState {
  readonly profileId: string;
  readonly testedAt: string;
  readonly ok: boolean;
  readonly errorMessage?: string;
}

export interface CreateProviderProfileInput {
  readonly displayName: string;
  readonly providerType: ProviderProfileType;
  readonly baseUrl?: string;
  readonly modelId?: string;
  readonly presetId?: string;
}

export interface UpdateProviderProfileInput {
  readonly displayName?: string;
  readonly baseUrl?: string;
  readonly modelId?: string;
}
