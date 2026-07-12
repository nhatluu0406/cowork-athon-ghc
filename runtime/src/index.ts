/**
 * @cowork-ghc/runtime — OpenCode pin + launch/config + process-identity glue.
 * Public surface for the Local Service (ADR 0001/0004, design §8/§9).
 */

export {
  OPENCODE_PIN,
  type OpencodePin,
  normalizeVersion,
  isPinnedVersion,
  checkPin,
  type PinGateResult,
  PinMismatchError,
  assertPinnedVersion,
  runtimeVersionInfo,
  type RuntimeVersionInfo,
} from "./pin.js";

export {
  type BuiltInProviderId,
  type ProviderEnvSpec,
  BUILTIN_PROVIDER_ENV,
  OPENAI_COMPATIBLE_NPM,
  builtInProviderEnv,
  customOpenAiCompatibleEnv,
} from "./provider-env.js";

export {
  type RuntimeProcessIdentity,
  type CaptureIdentityInput,
  captureIdentity,
  parseIdentityRecord,
  identityMatches,
} from "./process-identity.js";

export {
  type ProviderKeyInjection,
  type BuildLaunchSpecOptions,
  type RuntimeLaunchSpec,
  NonLoopbackHostError,
  buildLaunchSpec,
  injectionFor,
  redactedEnvSnapshot,
} from "./launch-config.js";

export { redactEnvMapValues, envMapContainsNoSecret } from "./redact.js";

export { isValidEnvName } from "./env-name.js";
