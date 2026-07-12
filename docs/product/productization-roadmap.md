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

The next implementation Agent is Cursor. The next recommended slice is:

```text
Skills Foundation
```

## Active Phases

| Phase | Summary | Entry | Exit acceptance |
|---|---|---|---|
| A - Safety and Functional Honesty | Attachment honesty, secret blocking, provider readiness preflight, small a11y fixes. | Packaged POC baseline and docs are clean. | **CLOSED** — packaged evidence from attachment-honesty + provider-readiness journeys. |
| B - Skills Foundation | Local Skills model, discovery, enable/disable, runtime integration, provenance. | Phase A packaged evidence exists. | A local Skill can be used and disabled in packaged app without marketplace/cloud. |
| C - File Work Review | Contextual preview, create/modify/delete presentation, before/after diff, read-source distinction, audit visibility. | Agent file work is stable enough to review. | User can understand what changed and why before/after file work. |
| D - Context Expansion | Folder/PDF/image/Office/drag-drop only when product need is explicit. | Attachment honesty is complete and PO selects a context type. | Each new type has bounded validation and packaged verification. |
| E - Full Packaged Release Verification | Live streaming, tools, permissions, cancellation, provider recovery, continuation, relaunch, installed keyring, native picker, high-DPI/keyboard. | Feature surface frozen for RC pass. | One documented packaged journey distinguishes manual/native/live from automation-only evidence. |
| F - Final UX Polish | Icons for status, minimal functional animation, spacing/type/color, consistent states. | Functional truth is solid. | Polish improves comprehension without new scope. |
| G - Distribution | Installer, versioning, upgrade, uninstall, migration, release candidate. | RC verification is green enough. | Windows install/upgrade/uninstall/keyring/workspace behavior verified. |

## Do Not Start Yet

- Skills before Phase A blockers are closed — Phase A is closed; Skills is next when PO approves.
- Attachments Phase 2 before attachment honesty exists.
- Full workspace explorer without evidence of need.
- Universal Preview tab for MVP.
- Web/Next.js.
- Cloud/multi-user/marketplace.

## References

- Current status: [current-status.md](./current-status.md)
- UX audit and packaged evidence: [product-ux-gap-audit.md](./product-ux-gap-audit.md)
- Acceptance summary: [../quality/poc-acceptance.md](../quality/poc-acceptance.md)
- Known limitations: [../quality/known-limitations.md](../quality/known-limitations.md)
- Architecture overview: [../architecture/system-overview.md](../architecture/system-overview.md)
