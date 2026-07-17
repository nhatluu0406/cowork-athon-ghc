# MS365 Service Layer Merge — Design

- **Date:** 2026-07-16
- **Author:** paired with Product Owner (brainstorming session)
- **Status:** Approved for planning
- **Scope tag:** `Merge/` → main, MS365 service layer only

## 1. Problem & context

The repo has an untracked `Merge/` directory holding a **fuller MS365 feature set** than the
baseline currently on `main`:

- **main baseline** (`service/src/ms365/`): SharePoint read over Graph, connector, tool-router,
  view, manual + device-code token providers — gated OFF-by-default behind `CGHC_MS365_ENABLED`.
- **`Merge/` snapshot**: adds Lists / Planner / Outlook / Teams CRUD, site-scope, write-mode,
  session-scope, batch tools, plus a tab-chat UI and OpenCode plugin-file wiring.

Critically, `Merge/`'s **OpenCode-coupled files are an OLDER fork of `main`**: its
`opencode-config.ts` / `supervisor.ts` dropped `main`'s `skills` / `skillAllow` permission work and
replaced it with an `ms365Enabled` parameter + MS365 plugin-file injection. Blindly copying those
would **regress** the skills permission surface on `main`. Its `compose-service.ts` is likewise
missing `main`'s MCP / agents / tasks / auth routers.

## 2. Goals (this pass)

1. Merge the **MS365 service layer only** (backend), copying it into the `main` tree.
2. **Remove all handling of `CGHC_MS365_ENABLED`** — the MS365 router mounts **unconditionally**
   (no default-OFF gate). `CGHC_MS365_TOKEN` and `CGHC_MS365_TOOL_ENDPOINT` drop naturally with the
   deferred OpenCode wiring.
3. Leave OpenCode runtime wiring untouched, to apply in a later pass.
4. Defer the entire UI shell (app-shell, dispatch-plan prompt, service-client, CSS, `microsoft/*`)
   to a later pass — "consider lại sau".

**Non-goal this pass:** a green build / typecheck / test run. The Product Owner explicitly deferred
build ("chưa cần phải build"). We prioritise landing the correct source into the correct location;
build/typecheck/test go green in the follow-up pass together with the UI and OpenCode wiring.

## 3. Approach — "Cách A": manual layered port

Do **not** copy the `Merge/` tree wholesale. Three groups, handled differently.

### Group 1 — Copy verbatim (pure MS365 service; confirmed zero OpenCode coupling)

`grep` confirmed none of these import `opencode` / `supervisor` / `plugin-file` / `launch-config`.

`service/src/ms365/` — **13 new files:**

- `lists-service.ts`, `planner-service.ts`, `outlook-service.ts`, `teams-service.ts`
- `site-scope-service.ts`, `site-scope-store.ts`, `site-scope-file-persistence.ts`
- `write-mode-store.ts`, `write-mode-file-persistence.ts`
- `ms365-session-scope.ts`, `ms365-batch-tools.ts`, `ms365-gate-wait.ts`, `token-scopes.ts`

`service/src/ms365/` — **9 changed files** (copy over):

- `graph-client.ts`, `ms365-connector.ts`, `ms365-errors.ts`, `ms365-tool-router.ts`,
  `ms365-tools.ts`, `ms365-view.ts`, `sharepoint-service.ts`, `token-provider.ts`

> `device-code-provider.ts` exists only on `main` (not in `Merge/`) — **keep `main`'s**, do not delete.

`service/tests/` — copy the MS365 tests, **except** the four OpenCode-coupled ones:

- **Copy:** `ms365-batch-tools`, `ms365-connector-device`, `ms365-device-config`,
  `ms365-device-routes`, `ms365-errors`, `ms365-gate-wait`, `ms365-graph-client`,
  `ms365-lists-service`, `ms365-lists-tool`, `ms365-manual-token`, `ms365-outlook-service`,
  `ms365-outlook-tool`, `ms365-planner-service`, `ms365-planner-tool`, `ms365-scoped-token`,
  `ms365-session-scope`, `ms365-sharepoint-site-filter`, `ms365-site-scope-file-persistence`,
  `ms365-site-scope-service`, `ms365-site-scope-store`, `ms365-sites-routes`, `ms365-sites-tool`,
  `ms365-teams-service`, `ms365-teams-tool`, `ms365-token-scopes`, `ms365-tool-router`,
  `ms365-view-redaction`, `ms365-write-mode`
- **Skip (OpenCode, deferred):** `ms365-child-env`, `ms365-supervisor-flag-predicate`,
  `ms365-plugin-file`, `opencode-config`

### Group 2 — Edit `main` files to remove the `CGHC_MS365_ENABLED` flag

Removing `isMs365Enabled` from `index.ts` forces touching the two `main` files that reference it,
or the tree will not even parse-resolve the import. This is intended.

- **`service/src/ms365/index.ts`**
  - Add re-exports for the new services (mirror `Merge/`'s `index.ts` export list).
  - **Remove `isMs365Enabled`** entirely.
  - **Keep `readMs365DeviceConfig`** (reads `CGHC_MS365_CLIENT_ID` / `CGHC_MS365_TENANT`, unaffected).

- **`service/src/composition/compose-service.ts`** (main's current file — port, do NOT overwrite
  with Merge's diverged copy)
  - Remove the `isMs365Enabled` import.
  - Change `const ms365Router = isMs365Enabled(process.env) ? (…) : undefined;` to construct the
    MS365 router **unconditionally** (drop the ternary + the `: undefined` branch).
  - Keep the existing SharePoint-only wiring as-is (new services stay copied-but-unwired this pass).
  - Preserve all of main's other routers (MCP / agents / tasks / auth / conversation).

- **`service/src/composition/live-launch.ts`**
  - Remove the MS365 child-env advertisement branch: the `isMs365Enabled` import + call, and the
    `CGHC_MS365_ENABLED` / `CGHC_MS365_TOKEN` / `CGHC_MS365_TOOL_ENDPOINT` `baseEnv` assignments.
  - This code is OpenCode-side; removing it here is both the flag-removal and part of the
    OpenCode deferral.

### Group 3 — Do NOT touch (deferred)

- **UI shell:** `app/ui/src/app-shell.ts`, `dispatch-plan.ts`, `service-client.ts`,
  `commercial.css`, `app/ui/src/ui-shell/microsoft/*`, `ms365-write-mode-control.ts`, and the UI
  tests. (Consider in a later pass.)
- **OpenCode runtime:** `service/src/runtime/supervisor.ts`, `opencode-config.ts`,
  `ms365-plugin-file.ts`, `service/src/runtime/supervisor-types.ts`,
  `runtime/src/launch-config.ts`, `service/src/server/http-service.ts` (scoped-token addition).
- **Deps:** `package-lock.json`, `runtime/package.json`.
- **Docs / reports** under `Merge/docs`, `Merge/reports`, `Merge/tools` — out of scope this pass
  (may be revisited when the feature is wired and demoed).

## 4. Flag decision (explicit)

| Env var | Decision | Rationale |
|---|---|---|
| `CGHC_MS365_ENABLED` | **Removed entirely** | User: "bỏ hết xử lý liên quan đến tag này". Router mounts unconditionally. |
| `CGHC_MS365_TOKEN` | Dropped with OpenCode | Only advertised the scoped tool token to the OpenCode child. |
| `CGHC_MS365_TOOL_ENDPOINT` | Dropped with OpenCode | Only advertised the loopback tool endpoint to the OpenCode child. |
| `CGHC_MS365_CLIENT_ID` | **Kept** | Device-code auth client id (service + connect UI). |
| `CGHC_MS365_TENANT` | **Kept** | Device-code tenant, defaults `common`. |

Note: `writeMode`, `siteScope`, `sessionScope` are **persisted user preferences / runtime state**,
not env flags — they are real features and are kept.

## 5. Consequences / known state after this pass

- The MS365 **service layer source** is present in the `main` tree; new services
  (Planner/Outlook/Teams/Lists/site-scope/write-mode/session-scope) are **copied but not yet wired**
  into `compose-service.ts` — they await a later wiring pass.
- The **SharePoint router mounts unconditionally** (gate removed).
- **Build / typecheck / tests are NOT expected to pass** this pass (deferred by decision). The
  follow-up pass wires the new services, restores the OpenCode runtime (on top of main's current
  skills-permission code, not Merge's older fork), lands the UI, and takes the tree green.

## 6. Risks

- **Regression risk from OpenCode files:** mitigated by explicitly NOT copying Merge's older
  `opencode-config.ts` / `supervisor.ts`.
- **Dead/unwired code:** accepted and expected this pass; tracked as the follow-up wiring task.
- **`compose-service.ts` divergence:** mitigated by porting the flag change into main's current file
  rather than adopting Merge's copy.
