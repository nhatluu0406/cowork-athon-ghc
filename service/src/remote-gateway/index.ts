/**
 * @cowork-ghc/service remote-gateway — phone/remote read access behind CGHC_REMOTE_ENABLED
 * (agent-harness-plan.md, remote feature MVP). OFF by default; the main loopback service is
 * byte-for-byte unaffected when the flag is unset.
 */

export {
  createPairingRegistry,
  type PairingRegistry,
  type PairingRegistryOptions,
  type PairedDeviceView,
  type ExchangeResult,
  type ExchangeFailureReason,
} from "./pairing.js";

export {
  startRemoteGateway,
  isRemoteEnabled,
  resolveRemoteBindHost,
  lanGatewayUrls,
  type RemoteGateway,
  type RemoteGatewayOptions,
} from "./gateway.js";
