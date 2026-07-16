export type {
  ProviderProfile,
  ProviderProfileView,
  ProviderProfileType,
  ConversationProviderSnapshot,
  ProfileConnectionTestState,
  CreateProviderProfileInput,
  UpdateProviderProfileInput,
} from "./types.js";

export { assertValidProfileId, envVarSuffixForProfileId } from "./profile-id.js";
export {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_PRESET_ID,
  DEEPSEEK_MODEL_OPTIONS,
  RUNTIME_ADAPTER_ID,
  friendlyModelLabel,
} from "./presets.js";
export { migrateLegacySettingsToProfiles } from "./migration.js";
export {
  createProviderProfileStore,
  createDeepSeekPresetInput,
  createCustomProfileInput,
  ProviderProfileStoreError,
  type ProviderProfileStore,
} from "./provider-profile-store.js";
export { createProviderConnectionTester, type ProviderConnectionTester } from "./provider-connection-tester.js";
export {
  createProfileModelDiscovery,
  type ProfileModelDiscovery,
  type ProfileModelDiscoveryOptions,
} from "./provider-model-discovery.js";
export { createProfileRuntimeBridge, type ProfileRuntimeBridge } from "./profile-runtime-bridge.js";
export {
  resolveRuntimeProviderConfig,
  conversationSnapshotFallback,
  runtimeProviderIdForProfile,
  type ResolvedRuntimeProvider,
} from "./runtime-provider-config.js";
export {
  createProviderProfileRouter,
  PROVIDER_PROFILES_PATH,
  PROVIDER_PROFILE_ITEM_PATH,
  PROVIDER_PROFILE_ACTIVE_PATH,
  PROVIDER_PROFILE_TEST_PATH,
  PROVIDER_PROFILE_CREDENTIAL_PATH,
  PROVIDER_PROFILE_DISCOVER_PATH,
} from "./router.js";
export {
  computeVerifiedTargetFingerprint,
  isVerificationCurrent,
} from "./verification-fingerprint.js";
