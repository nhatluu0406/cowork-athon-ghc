/**
 * Local barrel for the credential unit (CGHC-009, ADR 0006 / SEC-1, PR9).
 *
 * The single OS-backed credential store (Windows Credential Manager via `@napi-rs/keyring`),
 * modelled as a {@link CredentialStore} port with a real keyring adapter and an in-memory
 * fake, plus the credential service (handle-only state) and the inject-at-launch glue that
 * composes with the runtime launch seam. Secret scrubbing is the ONE shared value-based
 * scrubber owned by CGHC-021 (`../diagnostics`) — re-exported here for convenience; the
 * production composition root injects a single shared instance into the credential service.
 *
 * The top-level `service/src/index.ts` is intentionally NOT edited here; the orchestrator
 * wires this barrel (service + router) onto the boundary.
 */

export {
  type CredentialStore,
  type CredentialStoreKind,
  CredentialStoreError,
  CredentialNotFoundError,
  CREDENTIAL_SERVICE_NAME,
  credentialAccountFor,
  credentialRef,
} from "./store.js";

export { createMemoryStore } from "./memory-store.js";

export {
  KeyringUnavailableError,
  keyringAvailable,
  createKeyringStore,
} from "./keyring-adapter.js";

// The ONE shared secret scrubber lives in CGHC-021 (diagnostics); re-exported for convenience.
export {
  createSecretScrubber,
  type SecretScrubber,
} from "../diagnostics/index.js";

export {
  createCredentialService,
  type CredentialService,
  type CredentialServiceOptions,
  type StoreCredentialInput,
  type CredentialLog,
} from "./credential-service.js";

export {
  resolveInjections,
  buildLaunchSpecWithCredentials,
  redactedLaunchEnv,
  type CredentialInjectionRequest,
  type LaunchWithCredentialsOptions,
} from "./inject.js";

export {
  createCredentialRouter,
  CredentialRequestError,
  CREDENTIALS_PATH,
} from "./router.js";

export {
  M365_KNOWLEDGE_PROVIDER_ID,
  m365KnowledgeAccount,
  m365KnowledgeCredentialRef,
  storeM365KnowledgeToken,
  hasM365KnowledgeToken,
  resolveM365KnowledgeToken,
  removeM365KnowledgeToken,
} from "./m365-knowledge.js";
