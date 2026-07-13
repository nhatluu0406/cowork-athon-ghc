/**
 * Settings boundary router (CGHC-022, SD1/SD4/LOW-1). Mounts on the CGHC-002 loopback
 * boundary so the renderer is a true CLIENT of the service for viewing/editing settings —
 * never a filesystem/credential passthrough. Every route is TOKEN-GUARDED (no
 * `publicUnauthenticated`).
 *
 * Secret discipline: the credential route accepts a {@link CredentialRef} HANDLE only
 * (`store` + `account`); it rejects any key-shaped payload. The GET view returns a
 * NON-SECRET projection — a `hasCredential` flag + the account label, never a key. Session
 * model overrides are ephemeral, so clearing one (LOW-1) is delegated to the injected
 * model port, not the persistent store.
 */

import type { ModelRef } from "@cowork-ghc/contracts";
import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import type { SettingsStore } from "./settings-store.js";
import type { GeneralSettings } from "./settings-types.js";
import type { ProviderProfileStore } from "../provider-profiles/provider-profile-store.js";
import {
  SettingsRequestError,
  asRecord,
  parseCredentialRef,
  parseGeneralPatch,
  parseModelRef,
  requireNonEmptyString,
  requireProviderId,
} from "./settings-parse.js";

export { SettingsRequestError } from "./settings-parse.js";

export const SETTINGS_PATH = "/v1/settings";
export const SETTINGS_GENERAL_PATH = "/v1/settings/general";
export const SETTINGS_CREDENTIAL_PATH = "/v1/settings/providers/credential";
export const SETTINGS_BASE_URL_PATH = "/v1/settings/providers/base-url";
export const SETTINGS_ENV_VAR_PATH = "/v1/settings/providers/env-var";
export const SETTINGS_DEFAULT_MODEL_PATH = "/v1/settings/model/default";
export const SETTINGS_SESSION_MODEL_PATH = "/v1/settings/model/session";
export const SETTINGS_ACTIVE_WORKSPACE_PATH = "/v1/settings/active-workspace";

/** The narrow model capability the router needs: clear a per-session override (LOW-1). */
export interface SettingsModelPort {
  /** Remove a session's model override; returns whether one existed. */
  clearSessionModel(sessionId: string): boolean;
  /** The default model in effect after any clear (for the UI to confirm the revert). */
  defaultModelRef(): ModelRef | undefined;
}

/** Non-secret settings projection returned to the renderer (never a key). */
export interface SettingsView {
  readonly general: GeneralSettings;
  readonly providers: readonly {
    readonly providerId: string;
    readonly hasCredential: boolean;
    readonly credentialAccount?: string;
    readonly baseUrl?: string;
    readonly envVar?: string;
  }[];
  readonly defaultModel: ModelRef | null;
  readonly activeWorkspace: { readonly rootPath: string } | null;
  readonly providerProfiles?: readonly import("../provider-profiles/types.js").ProviderProfileView[];
  readonly activeProfileId?: string | null;
}

function toView(store: SettingsStore, profiles?: ProviderProfileStore): SettingsView {
  const providers = store.listProviderSettings().map((p) => ({
    providerId: p.providerId,
    hasCredential: p.credentialRef !== undefined,
    ...(p.credentialRef !== undefined ? { credentialAccount: p.credentialRef.account } : {}),
    ...(p.baseUrl !== undefined ? { baseUrl: p.baseUrl } : {}),
    ...(p.envVar !== undefined ? { envVar: p.envVar } : {}),
  }));
  return {
    general: store.general(),
    providers,
    defaultModel: store.defaultModel() ?? null,
    activeWorkspace: store.activeWorkspace() ?? null,
    ...(profiles !== undefined
      ? {
          providerProfiles: profiles.listViews(),
          activeProfileId: profiles.activeProfileId() ?? null,
        }
      : {}),
  };
}

/** Build the settings router. The orchestrator mounts it via `service.mount` (later task). */
export function createSettingsRouter(
  store: SettingsStore,
  models: SettingsModelPort,
  profiles?: ProviderProfileStore,
): BoundaryRouter {
  return {
    name: "settings",
    routes: [
      {
        method: "GET",
        path: SETTINGS_PATH,
        handler: (): RouteResult<{ settings: SettingsView }> => ({
          status: 200,
          data: { settings: toView(store, profiles) },
        }),
      },
      {
        method: "PATCH",
        path: SETTINGS_GENERAL_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ settings: SettingsView }>> => {
          await store.updateGeneral(parseGeneralPatch(asRecord(ctx.body)));
          return { status: 200, data: { settings: toView(store, profiles) } };
        },
      },
      {
        method: "PUT",
        path: SETTINGS_CREDENTIAL_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ settings: SettingsView }>> => {
          const record = asRecord(ctx.body);
          await store.setProviderCredentialRef(requireProviderId(record), parseCredentialRef(record));
          return { status: 200, data: { settings: toView(store, profiles) } };
        },
      },
      {
        method: "DELETE",
        path: SETTINGS_CREDENTIAL_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ settings: SettingsView }>> => {
          await store.removeProviderCredentialRef(requireProviderId(asRecord(ctx.body)));
          return { status: 200, data: { settings: toView(store, profiles) } };
        },
      },
      {
        method: "PUT",
        path: SETTINGS_BASE_URL_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ settings: SettingsView }>> => {
          const record = asRecord(ctx.body);
          const baseUrl = requireNonEmptyString(record.baseUrl, "baseUrl");
          await store.setProviderBaseUrl(requireProviderId(record), baseUrl);
          return { status: 200, data: { settings: toView(store, profiles) } };
        },
      },
      {
        method: "PUT",
        path: SETTINGS_ENV_VAR_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ settings: SettingsView }>> => {
          const record = asRecord(ctx.body);
          const envVar = requireNonEmptyString(record.envVar, "envVar");
          await store.setProviderEnvVar(requireProviderId(record), envVar);
          return { status: 200, data: { settings: toView(store, profiles) } };
        },
      },
      {
        method: "PUT",
        path: SETTINGS_DEFAULT_MODEL_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ settings: SettingsView }>> => {
          const record = asRecord(ctx.body);
          const model = record.model === null ? undefined : parseModelRef(record.model);
          await store.setDefaultModel(model);
          return { status: 200, data: { settings: toView(store, profiles) } };
        },
      },
      {
        method: "DELETE",
        path: SETTINGS_SESSION_MODEL_PATH,
        handler: (ctx: RouteContext): RouteResult<{ cleared: boolean; defaultModel: ModelRef | null }> => {
          const record = asRecord(ctx.body);
          const sessionId = record.sessionId;
          if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
            throw new SettingsRequestError("sessionId is required.");
          }
          const cleared = models.clearSessionModel(sessionId);
          return { status: 200, data: { cleared, defaultModel: models.defaultModelRef() ?? null } };
        },
      },
      {
        method: "PUT",
        path: SETTINGS_ACTIVE_WORKSPACE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult<{ settings: SettingsView }>> => {
          const record = asRecord(ctx.body);
          const rootPath = requireNonEmptyString(record.rootPath, "rootPath");
          await store.setActiveWorkspace(rootPath);
          return { status: 200, data: { settings: toView(store, profiles) } };
        },
      },
    ],
  };
}
