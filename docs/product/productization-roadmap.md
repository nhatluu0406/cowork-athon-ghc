---
language: "vi"
status: "active-summary"
updated_at: "2026-07-12"
---

# Productization Roadmap Summary

Canonical product plan: [Cowork GHC Product Plan](./cowork-ghc-product-plan.md)

This file is a short navigation summary only. The active roadmap, non-goals,
Product Owner decisions, and baseline matrix live in the canonical plan.

## Current Direction

Cowork GHC remains a Windows packaged desktop product. Web/Next.js, cloud sync,
multi-user, marketplace, full workspace explorer, and universal Preview tab are deferred.

The next implementation Agent is Cursor. The next implementation action remains:

```text
Diagnose and re-run packaged File Work Review A-L
```

Minimal Workspace Navigator is planned only after packaged File Work Review A-L passes
and the Product Owner issues that implementation brief.

## Active Phases

| Phase | Summary | Entry | Exit acceptance |
|---|---|---|---|
| A - Safety and Functional Honesty | Attachment honesty, secret blocking, provider readiness preflight, small a11y fixes. | Packaged POC baseline and docs are clean. | **CLOSED** — packaged evidence from attachment-honesty + provider-readiness journeys. |
| B - Skills Foundation | Local Skills model, discovery, enable/disable, runtime integration, provenance. | Phase A packaged evidence exists. | **PHASE 1 PASS** — packaged A–J; ecosystem/MCP/marketplace/cloud deferred. |
| C - File Work Review | Contextual preview, create/modify/delete presentation, before/after diff, read-source distinction, audit visibility. | Agent file work is stable enough to review. | **PARTIAL PASS** — implementation, release regression, and Windows package build pass; packaged live A-L has not passed yet. |
| D - Context Expansion | Folder/PDF/image/Office/drag-drop only when product need is explicit. | Attachment honesty is complete and PO selects a context type. | Each new type has bounded validation and packaged verification. |
| E - Full Packaged Release Verification | Live streaming, tools, permissions, cancellation, provider recovery, continuation, relaunch, installed keyring, native picker, high-DPI/keyboard. | Feature surface frozen for RC pass. | One documented packaged journey distinguishes manual/native/live from automation-only evidence. |
| F - Final UX Polish | Icons for status, minimal functional animation, spacing/type/color, consistent states. | Functional truth is solid. | Polish improves comprehension without new scope. |
| G - Distribution | Installer, versioning, upgrade, uninstall, migration, release candidate. | RC verification is green enough. | Windows install/upgrade/uninstall/keyring/workspace behavior verified. |

## Do Not Start Yet

- Skills ecosystem expansion beyond Phase 1 (MCP/marketplace/cloud/plugins) remains deferred.
- Attachments Phase 2 before attachment honesty exists.
- Full workspace explorer without evidence of need.
- Minimal Workspace Navigator until packaged File Work Review A-L passes.
- Universal Preview tab for MVP.
- Web/Next.js.
- Cloud/multi-user/marketplace.

## Parallel external integration tracks

These tracks are future integration surfaces expected from other teams. They do not
replace the core Cowork GHC roadmap A-G and they do not block all core work, but UI
surfaces for them must not be shown as current capability before real integrations exist.

| ID | Track | Current Cowork GHC status | Future UI surface |
|---|---|---|---|
| D1 | Dispatch / fan-out agent | Not implemented; development and runtime baseline remain LEAN single-agent. | Concurrency, child task status, and dispatch controls. |
| D2 | Microsoft automation: Teams, SharePoint, OneDrive, Graph | Not implemented; reference webhook/filesystem ideas are not Graph integration. | Microsoft 365 tab/status. |
| D3 | Knowledge system: RAG, vector, graph | Not implemented as accepted backend. | Structure/RAG tab. |
| D4 | Advanced LLM gateway: key pool, rotation, load balance, failover, cost routing | Not implemented; current provider abstraction remains baseline. | Gateway health/routing settings. |

## References

- Current status: [current-status.md](./current-status.md)
- UX audit and packaged evidence: [product-ux-gap-audit.md](./product-ux-gap-audit.md)
- External Cowork reference audit: [../references/coworklocalallos3-capability-audit.md](../references/coworklocalallos3-capability-audit.md)
- Frontend design assessment: [../references/cowork-frontend-design-assessment.md](../references/cowork-frontend-design-assessment.md)
- Acceptance summary: [../quality/poc-acceptance.md](../quality/poc-acceptance.md)
- Known limitations: [../quality/known-limitations.md](../quality/known-limitations.md)
- Architecture overview: [../architecture/system-overview.md](../architecture/system-overview.md)
