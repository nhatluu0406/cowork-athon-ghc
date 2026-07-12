// FIXTURE (allowed direction): an app/ui file importing only shared contracts and
// reaching business logic through the loopback service client. NOT compiled by tsc
// (test/fixtures is excluded); it exists only as text for the boundary lint to scan.
import type { EvEvent, SessionMeta } from "@cowork-ghc/contracts";
import { loopbackClient } from "../../service-client/loopback.js";

export function renderTimeline(_meta: SessionMeta, _events: readonly EvEvent[]): void {
  void loopbackClient;
}
