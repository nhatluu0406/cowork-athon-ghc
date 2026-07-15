/**
 * Pure decision logic for the `connectLive` force-reconnect gate.
 *
 * `composeLiveCoworkService` bakes both the provider/model AND the workspace root into the
 * running live service at start time (`service/src/composition/compose-live.ts`:
 * `grantWorkspace({ rootPath: workspaceId })` — one grant per running service, not per
 * request/session). So once the running service's launch config drifts from what is persisted
 * (a workspace switch, or a provider/model/credential change), a plain `connectLive()` must NOT
 * short-circuit as "already live" — it needs to force a stop+restart so the new config actually
 * takes effect. Extracted as a pure function (no DOM, no bridge) so the gating decision is
 * unit-testable without mounting `app-shell.ts`.
 */

/** Decide the `connectLive` argument for the current dirty flag. `undefined` means "no force". */
export function connectLiveOptsFor(liveConfigDirty: boolean): { readonly force: boolean } | undefined {
  return liveConfigDirty ? { force: true } : undefined;
}

/**
 * The next `liveConfigDirty` value once an `ensureLive` call has resolved successfully. Always
 * `false`: either the flag was already clear, or this call was forced (because it was set) and a
 * successful forced reconnect is exactly the event that clears it.
 */
export function nextLiveConfigDirtyAfterConnect(): false {
  return false;
}
