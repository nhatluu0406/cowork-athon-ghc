# Cowork GHC Product Capability Audit

**Source of Truth:** Git HEAD, current production code, and canonical docs.
**Audit Type:** Lightweight, read-only capability audit.

## Capability Matrix

| Capability | Basic user action | Status | Evidence | Missing basic behavior | Complexity/debt |
|---|---|---|---|---|---|
| Application startup | Launch app, see UI shell | WORKS | Clean launch to "New Chat", native Windows controls | - | None |
| Workspace selection and file browsing | Choose workspace folder, view files | PARTIAL | `workspace-picker.ts`, `workspace-view.ts`, bounded text preview | Recursive deep traversal, rich preview (PDF/Office), direct editor | Bounded read-only navigator limits usefulness but avoids IDE complexity |
| Conversations | Create, view, resume sessions | WORKS | `conversation-store.ts`, context sidebar persistence | - | None |
| Chat and streaming | Send message, see streamed response | WORKS | `app-shell.ts` dispatch, OpenCode runtime integration | - | None |
| Provider profiles and switching | Change LLM provider | WORKS | Multi-Provider Profiles Phase 1 (DeepSeek + Custom), Settings UI | - | Settings UI provider section needs visual polish |
| Credentials | Save and use API keys | WORKS | Windows keyring integration, missing-credential preflight | - | None |
| Settings | Access and change preferences | WORKS | Full-screen Settings surface (Nhà cung cấp / Chung) | - | None |
| Attachments | Attach text files to prompt | WORKS | `transcript-context.ts`, explicit inclusion, secret-like blocking | Non-text attachments (PDF, images, Office), drag-and-drop | None |
| Skills | Enable/disable and use skills | WORKS | Skills Foundation Phase 1 (local `SKILL.md` discovery) | Skill marketplace, cloud catalog, full editor | None |
| File operations and permissions | Approve/deny agent actions | WORKS | `permission-bridge.ts`, Allow/Deny modal | - | Automated live LLM verification for permissions is brittle |
| File Work Review | Review created/modified/deleted files | PARTIAL | `file-review-service.ts`, before/after diffs | Direct editor integration, reliable delete tracking with OpenCode 1.17.11 | `tools/verify/*-packaged.mjs` test harnesses are overbuilt for live determinism |
| Conversation history/search/rename/delete | Manage past chats | WORKS | Context sidebar features (search, rename, delete) | - | None |
| Recovery and diagnostics | Recover from errors/crashes | WORKS | Terminal/error recovery, process cleanup, provider recovery | - | None |
| UI surfaces | Navigate app layout | WORKS | Hybrid 1a Airy + 1b rail, product rail, Cowork sidebar | - | None |
| D1–D4 placeholders | See future integration slots | DEFERRED | Surface registry slots, `awaiting_integration` state | Real data, backend adapters | None |

## 1. BASIC FEATURES ALREADY USABLE
- Local service lifecycle and application startup to a clean "New Chat" state.
- Provider and model configuration (Multi-Provider Profiles Phase 1) with secure Windows keyring integration.
- Chat streaming with OpenCode runtime, including basic conversation multi-turn persistence.
- Basic workspace selection and read-only minimal workspace navigation.
- Text-file attachments with explicit inclusion and secret-file redaction.
- Local Skills Foundation (instruction-only `.md` skills).
- File operations with explicit Allow/Deny permission boundaries.
- Basic File Work Review (create/modify diffs).

## 2. BASIC FEATURES STILL MISSING
- Rich file viewing and direct editing capabilities (PDF, Image, Office, source editing).
- Deep recursive workspace navigation/explorer.
- Drag-and-drop support for attachments.
- Reliable tracking of file deletions in File Work Review (blocked by OpenCode tool surface).
- D1-D4 External Integrations (Dispatch, Microsoft, Knowledge, Gateway).

## 3. OVERBUILT OR PREMATURE WORK
- The `tools/verify/file-review-packaged.mjs` and similar packaged live verification harnesses attempt to force deterministic outcomes from live LLMs (e.g., forcing a delete action). This is brittle and overbuilt relative to the basic product value; the verification strategy should split deterministic product-path tests from live-agent sanity checks.

## 4. TOP 3 NEXT SLICES
1. **External Integration Intake (D1-D4)**: Begin replacing the passive `awaiting_integration` slots with real backend adapters for Dispatch, Microsoft 365, Knowledge, and Advanced Gateway.
2. **Rich File Viewing & Editing**: Extend the bounded text preview to support direct editing and rich media (images, PDFs) to make the workspace more functional without becoming a full IDE.
3. **File Work Review Hardening**: Resolve the delete tracking limitation and split the verification harness to achieve a full PASS for Phase C.

## 5. ITEMS TO STOP WORKING ON
- **UI Shell Redesigns**: The UI Shell V3 is complete and aligned with the PO. Stop tweaking the shell layout, rails, and sidebar unless a new, major PO finding demands it.
- **Live LLM Deterministic Verification**: Stop trying to make live LLM tests perfectly deterministic for complex workflows like File Work Review delete journeys. Rely on deterministic seams for product logic.
- **Full IDE Workspace Explorer**: Stop building towards a full IDE-style recursive file explorer. Keep the Minimal Workspace Navigator as is until a clear product need emerges.
