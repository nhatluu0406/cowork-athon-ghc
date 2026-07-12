# CoworkLocalallOS_3 Capability Audit

Status: reference audit only  
Reference source: `.loop-engineer/source/CoworkLocalallOS_3`  
Canonical source of truth remains the Cowork GHC Git HEAD and product docs.

## 1. Executive summary

CoworkLocalallOS_3 is a broad PySide6 desktop reference product with a richer visible workspace surface than the current Cowork GHC POC. It includes a conversation shell, Code tab, file tree, in-app file preview/editor, Office/PDF extraction paths, local structure graph, Skills UI, Teams webhook notifications, provider abstraction, and PyInstaller packaging scripts.

The reference is useful as a product and UX study, but it must not be treated as implementation truth for Cowork GHC. In this audit environment the full GUI could not be run because `PySide6` and `pytest` were not installed. A small no-network core smoke was run against isolated file tools, conversation history, and structure graph code. Most capabilities below are therefore classified as implemented in source but not run, UI wired to source, documented/planned only, or unclear.

Cowork GHC already has stronger product honesty in several release-critical areas: Windows packaged POC baseline, Windows keyring credential direction, OpenCode runtime boundary, secret-like path policy, permissioned mutation boundary, and persistent File Work Review artifacts. File Work Review remains `PARTIAL PASS`; packaged live journeys A-L have not passed.

## 2. Source and audit method

Targeted inspection covered:

- README, BUILD, settings, and guideline docs.
- `pyproject.toml`, config example, tests, and build scripts.
- Application entrypoint and tab construction.
- Worker, provider, tool, permission, history, settings, Skills, document extraction, Teams, file viewer, Cowork tab, Code tab, and Structure graph modules.
- Release scripts and smoke/build documentation.

The audit intentionally did not read the entire `.loop-engineer` tree. It only inspected the allowed reference folder.

No code was copied from the reference.

## 3. Runtime/build status

| Check | Result | Notes |
|---|---|---|
| Python availability | Present | Python 3.12.10 was available. |
| GUI dependency | Not available | `PySide6` import failed. |
| Test runner | Not available | `pytest` import failed. |
| Full GUI run | Not run | Unsafe to claim runnable GUI without installing dependencies. |
| Core smoke | Verified in a runnable local flow | Isolated smoke covered file tool write/read, history save/list, and structure graph build. |
| Package build | Not run | PyInstaller scripts exist, but build was not executed. |

## 4. Capability inventory with evidence levels

| Area | Capability | Evidence level | Notes |
|---|---|---|---|
| Core cowork | Conversation/session history | Implemented in source but not full GUI run | JSON conversation history exists with local/OneDrive storage modes. |
| Core cowork | Streaming responses | Implemented in source but not run | OpenAI-compatible and Anthropic providers implement streaming/tool loops. |
| Core cowork | Cancellation | Implemented in source but not run | Worker cancel hooks and provider cancel checks exist. |
| Core cowork | Permission | Implemented in source but not run | Code Confirm/Auto gate exists for write/run/install. Durable permission history was not found. |
| Core cowork | Activity/progress plan | Implemented in source but not run | `update_plan` and plan UI paths exist. |
| Core cowork | Attachments | Implemented in source but not run | Composer supports paste, drag/drop, file chips, and document extraction. |
| Core cowork | Output files | Partly verified in a runnable local flow | Core file write/read was smoke-tested; full agent output promotion was not run. |
| Core cowork | File review/diff | Implemented in source but not equivalent | Permission preview/diff exists, but persistent before/after review artifact and historical relaunch behavior were not found. |
| Workspace | File tree | Implemented in source but not run | Code tab uses a filesystem model. |
| Workspace | File search | Not found | No dedicated search capability was confirmed. |
| Workspace | Recent/changed files | Unclear | History and output lists exist, but not a general recent/changed workspace feature. |
| Workspace | Preview | Implemented in source but not run | Text, Markdown, image, Office/PDF/LibreOffice paths exist. |
| Workspace | Direct text editing | Implemented in source but not run | File viewer has edit/save, but no strong conflict/dirty-state design was confirmed. |
| Workspace | Save/undo/dirty state | Unclear | Basic save toggle exists; robust undo/conflict handling was not verified. |
| Workspace | Open in OS/default app | Implemented in source but not run | Open containing folder and LibreOffice/external open paths exist. |
| Workspace | PDF/image/Office support | Implemented in source but not run | Office XML/PDF extraction and LibreOffice preview paths exist. |
| Workspace | Drag-and-drop | Implemented in source but not run | Composer drag/drop attachments are wired in source. |
| Agent platform | Skills | Implemented in source but not run | User skills and `/skill` routing exist. |
| Agent platform | Templates/workflow replay | Implemented in source but not run | Flow/workflow UI exists, but replay guarantees were not verified. |
| Agent platform | Agent dispatch/fan-out | Unclear | Multiple workers/conversations can run, but this is not a proven dispatch platform with child provenance. |
| Agent platform | Plan/Act/Auto modes | Implemented in source but not run | Code tab supports Plan/Act and Auto/Confirm style controls. |
| Agent platform | Tool registry | Implemented in source but not run | Tools are hardcoded Python functions rather than a replaceable registry. |
| Agent platform | Plugin/MCP support | Unclear | Optional codebase-memory CLI exists; general plugin/MCP platform was not found. |
| Knowledge | RAG/vector/graph | Partly implemented in source but not run | Local structure graph is implemented; true vector/RAG backend was not confirmed. |
| Knowledge | Code structure graph | Partly verified in a runnable local flow | Local graph builder smoke-tested on isolated files. |
| Integrations | Microsoft 365 | Documented/planned only | Teams webhook and OneDrive filesystem paths exist; Graph/SharePoint/Teams automation was not found. |
| Integrations | Teams notifications | Implemented in source but not run | Webhook notification sender exists. |
| Platform | Advanced LLM gateway | Not found | Provider abstraction exists; key pools, rotation, routing, and failover were not found. |
| Product quality | Local-first/security | Mixed | Path guard exists, but plaintext config secrets and auto-run/install modes are concerns. |
| Product quality | Provider abstraction | Implemented in source but not run | OpenAI-compatible and Anthropic adapters exist. |
| Product quality | Process lifecycle | Implemented in source but not run | QThread worker model exists. |
| Product quality | Installer | Implemented in scripts but not run | PyInstaller scripts and build docs exist. |
| Product quality | Accessibility/high-DPI | Unclear | No meaningful verification was found. |
| Product quality | Test quality | Unclear | Tests exist, but local run was blocked by missing test dependencies. |

## 5. Comparison with Cowork GHC

CoworkLocalallOS_3 has a broader visible desktop surface today: file tree, direct file preview/editor, Code tab, Structure graph tab, Skills manager, output folders, Office/PDF extraction, and Teams webhook notification concepts.

Cowork GHC has a stronger release-critical base: Electron packaged POC, local service boundary, OpenCode runtime, provider/model/keyring readiness, permissioned mutation path, secret-like attachment/file policy, Skills provenance, and persistent before/after File Work Review artifacts. Cowork GHC also keeps acceptance status more explicit: File Work Review is `PARTIAL PASS`, unit/release regression and Windows build pass, packaged live journeys A-L not pass yet.

## 6. Capabilities Cowork GHC already handles better

- Credential posture: Cowork GHC uses the Windows keyring direction; the reference stores configuration under the user profile and may persist provider keys in plaintext config.
- File Review: Cowork GHC has persistent before/after artifacts, hashes, unified diff, secret redaction, and historical relaunch behavior. The reference shows permission previews but not equivalent artifact persistence.
- Packaged verification discipline: Cowork GHC distinguishes unit/release regression, package build, and packaged live journeys. The reference has scripts/tests but they were not runnable here.
- Runtime boundary: Cowork GHC keeps an Electron shell, preload bridge, local service, OpenCode runtime, and replaceable LLM endpoint boundary. The reference is a monolithic PySide6 app with direct tool execution.
- Source-of-truth honesty: Cowork GHC active docs explicitly track limitations and blockers. The reference README overstates some areas relative to what was confirmed in source.
- Secret-like file policy: Cowork GHC blocks/redacts sensitive file paths in review surfaces. Equivalent deterministic redaction was not confirmed in the reference.

## 7. Capabilities worth adopting

Adopt as product lessons, not code reuse:

- A minimal workspace tree that is read-only first and becomes richer only after the packaged File Work Review blocker is closed.
- A rich preview surface for text, Markdown, images, PDF, and Office files, with clear "view context" versus "edit file" boundaries.
- Output file presentation that separates user-facing deliverables from intermediate scratch files.
- Plan/progress visibility in the main Cowork shell.
- Skills discoverability in the composer and settings surfaces.
- Structure graph as a future D3-dependent surface, not as a UI-only feature.
- Open containing folder / open in default Windows application, behind a safe OS-shell bridge.

## 8. Capabilities dependent on external systems

- Microsoft 365 automation depends on D2: Graph/Teams/SharePoint/OneDrive connectors, explicit auth, user consent, scopes, audit, and credential isolation.
- Structure/RAG depends on D3: ingestion/indexing, source provenance, stale-index handling, vector/graph backend, and local/remote data policy.
- Fan-out/concurrency depends on D1: dispatch, child status, cancellation, permission aggregation, resource limits, and result provenance.
- Advanced routing depends on D4: gateway adapter, key pool, rotation, failover, health, cost metadata, and direct-provider fallback.

## 9. Capabilities not recommended

- Do not copy plaintext provider key storage.
- Do not add Auto mode for write/run/install until Cowork GHC has explicit resource limits, permission aggregation, and audit behavior.
- Do not embed LibreOffice-style preview as a first step; it is powerful but fragile and should follow simpler preview capabilities.
- Do not expose Microsoft/Structure tabs as real product features before D2/D3 backends exist.
- Do not copy FPT branding, mock identities, or model names from reference materials.
- Do not adopt a monolithic direct-tool architecture that bypasses Cowork GHC's local service/OpenCode boundary.

## 10. Architecture lessons

- Keep provider abstraction replaceable, but avoid mixing direct provider keys with UI config files.
- Separate read-only workspace navigation from mutation and editing.
- Treat document extraction as a bounded service with size limits, source provenance, and secret handling.
- Treat file output promotion as a first-class UX concept: final deliverables should be easy to find; scratch output should be hidden or clearly marked.
- A future workspace surface should consume File Work Review artifacts rather than invent a second diff/history system.

## 11. UX lessons

- A Code/workspace surface can help users understand what the agent is touching, but the minimum should not become an IDE clone.
- The main Cowork shell benefits from a right-side information area for plan, files, activity, and review status.
- Skills should be discoverable near the composer and in settings.
- Output files should be visible as stable artifacts, not buried in chat text.
- Structure/RAG and Microsoft surfaces should be visually present only when backed by real integrations.

## 12. Security and local-first concerns

- Provider secrets in config are a downgrade from keyring-backed credentials.
- Auto-install and shell command tools increase supply-chain and local machine risk.
- Teams webhook notifications may leak task content if not scoped and audited.
- Office/PDF extraction must define file size, parser safety, provenance, and redaction behavior.
- OneDrive filesystem storage is not the same as Microsoft 365 API consent and audit.
- Any future Cowork GHC adoption must preserve least privilege, explicit permission, auditability, and local-first expectations.

## 13. Licensing/provenance or code-reuse uncertainty

The reference package declares MIT metadata, but this audit did not verify authorship, asset provenance, third-party license compliance, or whether generated design/source artifacts are safe to reuse. Treat the reference as inspiration only. Do not copy source code, assets, branding, mock data, or exact UI text into Cowork GHC without a separate provenance review.

## 14. Prioritized recommendations

### Adopt soon

- Improve product docs with clearer external-track boundaries.
- Borrow information architecture ideas for plan, files, activity, Skills discoverability, and output files.
- Keep File Work Review as the central mutation review surface.

### Adopt after current blocker

- Minimal Workspace Navigator.
- Rich File Preview.
- Open in default Windows application / reveal in Explorer.
- Recent/changed files driven by real workspace and review events.

### External-team dependency

- D1 dispatch/fan-out and concurrency controls.
- D2 Microsoft 365 automation surfaces.
- D3 Structure/RAG backend and source-provenance UI.
- D4 advanced LLM gateway/routing health surfaces.

### Long-term

- Direct text editing with dirty state, conflict detection, undo, and File Work Review integration.
- Office/PDF/image preview with bounded extraction and provenance.
- Workflow replay/templates with audit and permissions.

### Reject/defer

- Plaintext provider key persistence.
- Auto-run/write/install controls before D1-style resource and permission aggregation exists.
- IDE clone scope for the Code tab.
- Branding or mock model names from the reference materials.
