/**
 * Provider profiles HTTP router (Phase 1).
 */

import type { BoundaryRouter, RouteContext, RouteResult } from "../boundary/contract.js";
import { BadRequestError } from "../server/http-util.js";
import type { ProviderConnectionTester } from "./provider-connection-tester.js";
import type { ProfileModelDiscovery } from "./provider-model-discovery.js";
import type { ProfileRuntimeBridge } from "./profile-runtime-bridge.js";
import type { ProviderProfileStore } from "./provider-profile-store.js";
import { assertValidProfileId } from "./profile-id.js";
import type { CreateProviderProfileInput, UpdateProviderProfileInput } from "./types.js";

export const PROVIDER_PROFILES_PATH = "/v1/provider-profiles";
export const PROVIDER_PROFILE_ITEM_PATH = "/v1/provider-profiles/{id}";
export const PROVIDER_PROFILE_ACTIVE_PATH = "/v1/provider-profiles/active";
export const PROVIDER_PROFILE_TEST_PATH = "/v1/provider-profiles/{id}/test-connection";
export const PROVIDER_PROFILE_CREDENTIAL_PATH = "/v1/provider-profiles/{id}/credential";
export const PROVIDER_PROFILE_DISCOVER_PATH = "/v1/provider-profiles/{id}/discover-models";

export class ProviderProfileRequestError extends BadRequestError {
  constructor(message: string) {
    super(message);
    this.name = "ProviderProfileRequestError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new ProviderProfileRequestError("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requireId(params: Readonly<Record<string, string>>): string {
  const id = params["id"];
  if (id === undefined || id.length === 0) throw new ProviderProfileRequestError("id is required.");
  return assertValidProfileId(id);
}

function parseCreateBody(body: unknown): CreateProviderProfileInput {
  const rec = asRecord(body);
  const providerType = rec["providerType"];
  if (providerType !== "deepseek" && providerType !== "custom-openai-compat") {
    throw new ProviderProfileRequestError("providerType must be deepseek or custom-openai-compat.");
  }
  return {
    displayName: typeof rec["displayName"] === "string" ? rec["displayName"] : "",
    providerType,
    ...(typeof rec["baseUrl"] === "string" ? { baseUrl: rec["baseUrl"] } : {}),
    ...(typeof rec["modelId"] === "string" ? { modelId: rec["modelId"] } : {}),
    ...(typeof rec["presetId"] === "string" ? { presetId: rec["presetId"] } : {}),
  };
}

function parseUpdateBody(body: unknown): UpdateProviderProfileInput {
  const rec = asRecord(body);
  return {
    ...(typeof rec["displayName"] === "string" ? { displayName: rec["displayName"] } : {}),
    ...(typeof rec["baseUrl"] === "string" ? { baseUrl: rec["baseUrl"] } : {}),
    ...(typeof rec["modelId"] === "string" ? { modelId: rec["modelId"] } : {}),
  };
}

function validateDeleteProfile(input: ProviderProfileStore, id: string): void {
  const profiles = input.list();
  const existing = profiles.find((p) => p.id === id);
  if (existing === undefined) {
    throw new ProviderProfileRequestError("Profile not found.");
  }
  if (profiles.length <= 1) {
    throw new ProviderProfileRequestError("Bạn cần tạo một profile khác trước khi xóa profile này.");
  }
  if (input.activeProfileId() === id) {
    throw new ProviderProfileRequestError("Hãy đặt một profile khác làm active trước khi xóa profile này.");
  }
}

export function createProviderProfileRouter(input: {
  readonly profiles: ProviderProfileStore;
  readonly tester: ProviderConnectionTester;
  readonly discovery: ProfileModelDiscovery;
  readonly runtimeBridge: ProfileRuntimeBridge;
  readonly bindCredentialRef: (profileId: string, ref: { store: "os"; account: string }) => Promise<void>;
  readonly removeCredential: (profileId: string, account: string) => Promise<void>;
}): BoundaryRouter {
  return {
    name: "provider-profiles",
    routes: [
      {
        method: "GET",
        path: PROVIDER_PROFILES_PATH,
        handler: (): RouteResult => ({
          status: 200,
          data: {
            profiles: input.profiles.listViews(),
            activeProfileId: input.profiles.activeProfileId() ?? null,
          },
        }),
      },
      {
        method: "POST",
        path: PROVIDER_PROFILES_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const profile = await input.profiles.create(parseCreateBody(ctx.body));
          if (input.profiles.activeProfileId() === profile.id) {
            await input.runtimeBridge.syncActiveProfile();
          }
          return { status: 201, data: { profile } };
        },
      },
      {
        method: "PUT",
        path: PROVIDER_PROFILE_ITEM_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const id = requireId(ctx.params);
          const profile = await input.profiles.update(id, parseUpdateBody(ctx.body));
          if (input.profiles.activeProfileId() === id) {
            await input.runtimeBridge.syncActiveProfile();
          }
          return { status: 200, data: { profile } };
        },
      },
      {
        method: "DELETE",
        path: PROVIDER_PROFILE_ITEM_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const id = requireId(ctx.params);
          validateDeleteProfile(input.profiles, id);
          const existing = input.profiles.get(id);
          await input.profiles.delete(id);
          if (existing?.credentialRef !== undefined) {
            await input.removeCredential(id, existing.credentialRef.account);
          }
          await input.runtimeBridge.syncActiveProfile();
          return { status: 200, data: { deleted: true } };
        },
      },
      {
        method: "PUT",
        path: PROVIDER_PROFILE_ACTIVE_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const rec = asRecord(ctx.body);
          const profileId = rec["profileId"];
          if (typeof profileId !== "string" || profileId.length === 0) {
            throw new ProviderProfileRequestError("profileId is required.");
          }
          const profile = await input.profiles.setActive(assertValidProfileId(profileId));
          await input.runtimeBridge.syncActiveProfile();
          return { status: 200, data: { profile, activeProfileId: profile.id } };
        },
      },
      {
        method: "POST",
        path: PROVIDER_PROFILE_TEST_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const id = requireId(ctx.params);
          const profile = input.profiles.get(id);
          if (profile === undefined) throw new ProviderProfileRequestError("Profile not found.");
          const result = await input.tester.testProfile(profile);
          await input.profiles.recordConnectionVerification(id, result.ok);
          return {
            status: 200,
            data: {
              profileId: id,
              result,
              state: input.tester.lastResultFor(id) ?? null,
              profile: input.profiles.listViews().find((p) => p.id === id) ?? null,
            },
          };
        },
      },
      {
        method: "POST",
        path: PROVIDER_PROFILE_DISCOVER_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const id = requireId(ctx.params);
          const profile = input.profiles.get(id);
          if (profile === undefined) throw new ProviderProfileRequestError("Profile not found.");
          // Optional in-form (not-yet-saved) base URL override; discovery stays best-effort.
          const rec = asRecord(ctx.body);
          const override = typeof rec["baseUrl"] === "string" ? rec["baseUrl"] : undefined;
          const result = await input.discovery.discoverForProfile(
            profile,
            override !== undefined ? { baseUrlOverride: override } : {},
          );
          return { status: 200, data: { profileId: id, result } };
        },
      },
      {
        method: "PUT",
        path: PROVIDER_PROFILE_CREDENTIAL_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const id = requireId(ctx.params);
          const rec = asRecord(ctx.body);
          const ref = rec["ref"];
          if (typeof ref !== "object" || ref === null) {
            throw new ProviderProfileRequestError("ref is required.");
          }
          const account = (ref as Record<string, unknown>)["account"];
          const store = (ref as Record<string, unknown>)["store"];
          if (store !== "os" || typeof account !== "string") {
            throw new ProviderProfileRequestError("ref must be { store: 'os', account }.");
          }
          await input.bindCredentialRef(id, { store: "os", account });
          const profile = await input.profiles.setCredentialRef(id, { store: "os", account });
          if (input.profiles.activeProfileId() === id) {
            await input.runtimeBridge.syncActiveProfile();
          }
          return { status: 200, data: { profile } };
        },
      },
      {
        method: "DELETE",
        path: PROVIDER_PROFILE_CREDENTIAL_PATH,
        handler: async (ctx: RouteContext): Promise<RouteResult> => {
          const id = requireId(ctx.params);
          const existing = input.profiles.get(id);
          if (existing?.credentialRef !== undefined) {
            await input.removeCredential(id, existing.credentialRef.account);
          }
          const profile = await input.profiles.removeCredentialRef(id);
          if (input.profiles.activeProfileId() === id) {
            await input.runtimeBridge.syncActiveProfile();
          }
          return { status: 200, data: { profile } };
        },
      },
    ],
  };
}
