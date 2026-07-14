---
name: id-scheme
description: This project's REQ folders use REQ-<num>-<AREA>-<seq>-<slug>, not the plain REQ-XXX 3-digit default
metadata:
  type: project
---

The first REQ folder in this repo is `specs/REQ-204-M365-001-m365-knowledge-graph/` — pattern `REQ-<num>-<AREA-code>-<seq-in-area>-<slug>`, not the generic `REQ-XXX` 3-digit scheme. `REQ-204`'s number appears tied to a branch-number convention (`204-implement-final-gaps`). No documented ID-scheme doc exists elsewhere in the repo (checked `docs/`, `.specify/templates/`) — the pattern is precedent-only, established by that one folder plus a "Requirement-ID Scheme" resolution inside its own spec.md §18.7, which is about FR-numbering *within* a spec, not about the folder-naming convention itself.

**Why:** matched this precedent when creating REQ-205 (`specs/REQ-205-COWORK-001-m365-cowork-integration/`) — area code `COWORK` since that REQ is primarily Cowork-GHC-facing.

**How to apply:** for the next REQ in this repo, continue `REQ-<next-num>-<AREA>-001-<slug>` unless the user/PO establishes a different explicit convention. Don't default to plain `REQ-XXX` here.
