---
language: "vi"
status: "active"
updated_at: "2026-07-13"
---

# UI Shell V3 Cursor Handoff

## Baseline

- Branch: `fix/ui-shell-v3-commercial-readiness`
- Audit baseline: `ecce634` — `docs(quality): audit V3 commercial UI readiness`
- UI baseline commit: use the merge commit that includes the commercial-readiness remediation from this branch after Product Owner review.
- Evidence folder: `reports/ui-shell-v3-commercial-readiness/`

## Stable Shell Modules

- `app/ui/src/app-shell.ts` owns orchestration and state wiring.
- `app/ui/src/ui-shell/create-app-frame.ts` owns V3 frame composition.
- `app/ui/src/ui-shell/topbar.ts`, `product-rail.ts`, `contextual-sidebar.ts`, `cowork-view.ts`, `workspace-view.ts`, `knowledge-view.ts`, `integration-view.ts`, `inspector.ts`, `status-bar.ts`, `conversation-provider-control.ts`, and `tooltip.ts` own presentation boundaries.
- `app/ui/src/provider-readiness.ts` owns renderer status/preflight semantics.

## Invariants Not To Break

- Keep native Windows controls; do not draw custom minimize/maximize/close controls.
- Keep one product rail: `Cowork`, `Dispatch`, `Gateway`, `Knowledge`, `Microsoft 365`, `Code`.
- Do not add a separate Knowledge Graph rail item.
- Cowork and Workspace remain mutually exclusive work modes inside Cowork.
- Integration surfaces stay full-width after rail, with no Cowork sidebar or inspector.
- Inspector open must not collapse main content at 1366px or narrow widths.
- Tooltips must remain accessible, collision-aware, and free of clipped/ghost text.
- Status semantics must distinguish `Service`, `Runtime`, provider unconfigured, provider untested, provider ready, and provider failed.
- Do not show green/healthy status for `Chưa kiểm tra`.
- Do not fake D1-D4, provider profiles, graph, Microsoft, dispatch, gateway, or code capability.

## Settings Surface

Settings is a full-screen V3 application surface, not a modal. Entry points are topbar Settings, composer provider control, status bar provider status, and provider readiness CTA. The surface remembers the prior product surface and Back/Close returns there. Internal navigation is:

```text
Nhà cung cấp | Chung
```

Provider settings reuse existing production behavior: provider, model, Base URL, Windows keyring/API key state, save/delete credential, test connection, recovery. General settings reuse existing production settings. Multi-Provider Profiles are not implemented.

## Safe Extension Points

- Add real D1-D4 data only after integration code lands and docs/integration acceptance gates are satisfied.
- Extend Settings by adding panels inside the existing Settings surface, not by creating a second modal.
- Extend Workspace preview through service-backed routes; renderer must not read filesystem directly.
- Extend provider UI only when a real registry/profile model exists.

## Deferred

- D1-D4 backend integrations are not merged.
- Multi-Provider Profiles, routing, failover, and key pools are not implemented.
- File Work Review remains **PARTIAL PASS**.
- Full L9 / release-candidate verification is not complete.
- Direct editor, PDF/Office/image preview, and Web/Next.js remain deferred.

## Next Action

After Product Owner accepts the commercial-readiness screenshots, the next product action is integration intake for D1-D4. Do not redesign UI Shell V3 again unless a new Product Owner/audit finding explicitly requires it.
