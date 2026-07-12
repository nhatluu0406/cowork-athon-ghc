/**
 * Captured-frame fixture harness (CGHC-024, PR10). Public surface for tests + the capture
 * tool. Ships the FORMAT, LOADER, pin-GATE, and REPLAY mechanism — no fabricated frames.
 * Real fixtures land under `./data/*.ndjson` after the product-owner token gate.
 */

export {
  CAPTURE_META_KIND,
  CAPTURE_FRAME_KIND,
  CapturedFrameSchemaError,
  parseCapturedFrameFile,
  serializeCapturedFrameFile,
  type CapturedMeta,
  type CapturedFrame,
  type CapturedFrameFile,
} from "./schema.js";

export {
  CAPTURE_PIN,
  REQUIRED_CAPTURE_SCENARIOS,
  requiredScenario,
  type RequiredScenario,
} from "./manifest.js";

export {
  fixturesDataDir,
  fixturePath,
  capturedFrameFileExists,
  readCapturedFrames,
  loadCapturedFrames,
  type CapturedFrameLoad,
} from "./loader.js";

export {
  captureGateStatus,
  captureGateReport,
  evaluateCaptureGate,
  type CaptureGateStatus,
  type CaptureGateState,
} from "./gate.js";

export { replayCapturedFrames, type ReplayResult } from "./replay.js";

export { recordFrames, type RecordFramesInput } from "./recorder.js";
