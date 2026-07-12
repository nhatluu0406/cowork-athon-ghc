# Cowork Frontend Design Assessment

Status: reference design assessment only  
Reference source: `.loop-engineer/source/Cowork_frontend 1.pdf`  
Canonical source of truth remains the Cowork GHC Git HEAD and product docs.

## 1. Executive summary

The PDF proposes a light, airy redesign for a Cowork desktop shell. It presents three main Cowork shell directions (`1a Airy`, `1b Rail`, `1c Zen`) and additional capability screens for Cowork, Code, Structure/RAG, Microsoft 365, and Settings.

The strongest direction for Cowork GHC is `1a Airy`, now adopted as the integration-ready shell foundation: conversation sidebar, main chat workspace, and right information panel. It gives the main conversation enough room while preserving space for plan, activity, files, and File Work Review. `1b Rail` is useful as a future navigation pattern when multiple real product surfaces exist. `1c Zen` is useful as a focus mode or empty-state inspiration, but it hides too much operational status to be the primary shell for a packaged agent product.

The PDF is visual design reference, not product truth. Code, Structure/RAG, Microsoft 365, and concurrency controls are future surfaces that require backend/product capability. They must not appear as real tabs until the corresponding systems are implemented and accepted.

## 2. What the PDF actually proposes

The PDF is an eight-page visual redesign reference. The cover frames it as a Cowork Local desktop redesign with a light background, warm minimal style, and FPT orange accent. It groups the first screens as main chat shell alternatives and then shows additional capability surfaces.

Interpreted capability categories:

- Cowork shell: conversation sidebar, top tabs, central chat, plan/files panel, composer, provider/model selection, Skills, progress/status.
- Code workspace: workspace tree, tabs, preview/editor, diff, agent pane, mode controls, and terminal/test output.
- Structure/RAG: visual knowledge/structure graph surface.
- Microsoft 365: collaboration/enterprise integration surface.
- Settings: theme, provider/model, API key, notifications, Skills, attachment/output settings, and concurrency-style controls.

Classification:

| Surface | Classification |
|---|---|
| Main Cowork shell | Visual shell idea with some concepts already backed by Cowork GHC. |
| Code tab | Partly planned internally; many elements require Workspace Navigator, preview, editor, and terminal decisions. |
| Structure/RAG tab | Future surface dependent on D3. |
| Microsoft 365 tab | Future surface dependent on D2. |
| Settings | Mixed: provider/key/settings exist in Cowork GHC direction; concurrency and integration controls depend on D1-D4. |

## 3. Assessment of 1a / 1b / 1c

### 1a Airy

Fit with Cowork GHC: high. It keeps the conversation as the primary work surface while making room for operational context.

Migration cost: medium. It can be staged by adjusting shell layout, sidebar density, plan/files/activity placement, and status hierarchy without starting the Workspace Navigator implementation immediately.

Scalability: good. It can grow into a plan/files/activity/right-panel model and later host rich preview without forcing every feature into top-level tabs.

Desktop/high-DPI: good if spacing is bounded and right-panel widths are stable. Avoid oversized empty space on 1366x768.

Discoverability: good. It can expose provider/model, Skills, attachments, progress, and File Work Review near the main flow.

Activity/File Review: strong fit. A right-side information region can show review artifacts without hiding the conversation.

Conversation history: compatible with left sidebar history.

Risk: if made too airy, critical status may become visually soft. Cowork GHC needs clear PASS/PARTIAL/BLOCKED states and packaged verification honesty.

Conclusion: recommended primary direction and current shell foundation. This does not change File Work Review acceptance; the slice remains `PARTIAL PASS`.

### 1b Rail

Fit with Cowork GHC: medium. A rail helps when the product truly has multiple top-level surfaces, but Cowork GHC should not imply Code/RAG/Microsoft capability before those systems exist.

Migration cost: medium-high. A rail changes app navigation and could prematurely invite hidden or disabled tabs.

Scalability: strong once D1-D4 and workspace capabilities exist.

Desktop/high-DPI: good for dense desktop apps, but labels/tooltips and keyboard navigation must be clear.

Discoverability: mixed. It gives stable places for surfaces, but icon-only rails can hide product status.

Activity/File Review: useful if File Review remains a visible panel, not buried behind a tab.

Conversation history: can coexist with a second sidebar, but two navigation columns may feel heavy.

Risk: encourages shipping aspirational tabs as placeholders.

Conclusion: keep as future navigation inspiration, not the immediate shell.

### 1c Zen

Fit with Cowork GHC: low-medium for the primary shell; good for focused conversation states.

Migration cost: low-medium visually, but product cost is high if it hides status, files, and review evidence.

Scalability: limited. It does not naturally support activity, plan, files, and review at the density Cowork GHC needs.

Desktop/high-DPI: pleasant on large screens, but may waste space in operational workflows.

Discoverability: lower. Important controls can become secondary or hidden.

Activity/File Review: weak unless augmented with an always-visible status panel.

Conversation history: can work, but the concept appears optimized for calm focus rather than repeated product work.

Risk: makes a partially verified product feel cleaner than it is.

Conclusion: use as focus-mode or empty-state inspiration only.

## 4. Recommended shell direction

Use `1a Airy` as the main design direction, with these constraints:

- Preserve functional truth over visual calm.
- Keep File Work Review status visible and honest.
- Keep packaged blocker status visible until A-L passes.
- Do not show Code, Structure/RAG, Microsoft 365, or concurrency as active capabilities before backend support exists.
- Do not copy FPT branding, PDF mock identities, or mock model names.
- Let capability drive layout: a workspace panel can be better than a hard-coded `Preview` tab.

## 5. Current UI versus proposed design

| Area | Current Cowork GHC | PDF direction | Assessment |
|---|---|---|---|
| Main shell | Integration-ready `1a Airy` foundation with right-panel File Work Review area | More polished conversation + side information layout | Adopted as shell foundation; acceptance honesty remains unchanged. |
| Conversation history | Exists as product direction/source capability | Left sidebar history | Compatible. |
| Provider/model | Provider readiness exists | Visible selector | Safe to adopt if backed by real settings/keyring status. |
| Skills | Foundation pass | Skills entry in composer/settings | Safe to improve discoverability. |
| Plan/progress | Product direction exists | Visible plan/progress panel | Safe if driven by real activity events. |
| Files/activity | File Review exists; workspace tree not started | Plan/files panel | Adopt as information architecture; do not start navigator in this task. |
| Code tab | Not current capability | Workspace/editor/terminal shell | Future staged capability; avoid IDE clone. |
| Structure/RAG | Not current capability | Graph/knowledge tab | Requires D3 backend. |
| Microsoft 365 | Not current capability | M365 tab | Requires D2 backend. |
| Concurrency controls | Not current runtime baseline | Settings/agent controls | Requires D1; do not expose early. |

## 6. Elements safe to adopt early

- Clearer conversation/sidebar balance.
- Stable right-side information architecture for activity, plan, files, and File Work Review.
- Stronger status hierarchy for PASS, PARTIAL, BLOCKED/NOT PASS, NOT STARTED, and DEFERRED.
- Provider/model selector only when backed by real provider state.
- Skills discovery in composer and settings.
- Output file presentation as explicit artifacts.
- Light/dark theme polish only after current packaged truth remains visible.

## 7. Elements requiring product capabilities

- Workspace tree and file search require Minimal Workspace Navigator.
- Rich preview requires preview service/policy decisions.
- Direct text editing requires dirty state, conflict handling, permission semantics, and File Work Review integration.
- Terminal/test output requires command execution policy and packaged verification.
- Structure/RAG requires D3.
- Microsoft 365 requires D2.
- Multi-agent concurrency/fan-out requires D1.
- Advanced provider routing requires D4.

## 8. Code workspace assessment

The Code screen is useful as a future direction, but Cowork GHC should not become an IDE clone. The minimum viable version should be:

- Workspace tree.
- Read-only preview first.
- File Review/diff visibility.
- Open/reveal actions.
- Agent activity pane.
- Clear permission state.

Direct editing, terminal/test output, Plan/Act/Auto/Confirm mode controls, and multi-file workspace tabs should follow only after the underlying backend and safety model are ready. Auto mode should not appear until D1-style resource limits, permission aggregation, and cancellation semantics exist.

## 9. RAG and Microsoft 365 dependency mapping

Structure/RAG maps to D3. Required backend capabilities:

- Ingestion/index boundary.
- Workspace opt-in.
- Source provenance.
- Stale index handling.
- Replaceable vector/graph backend.
- Local versus remote data policy.

Microsoft 365 maps to D2. Required backend capabilities:

- Authentication and explicit user consent.
- Least-privilege Graph scopes.
- Teams, SharePoint, OneDrive, and Graph connector status.
- Audit trail.
- Credential isolation.
- Error/status surface.

These tabs should remain hidden, disabled as future, or clearly marked as not connected until the respective systems are accepted.

## 10. Settings assessment

Safe settings surfaces:

- Theme.
- Provider/model.
- API key/keyring status.
- Notifications when backed by real local settings.
- Skills management.
- Attachment and output settings.

Settings that require backend capability:

- Concurrency controls: depends on D1.
- Microsoft connectors: depends on D2.
- Knowledge/RAG settings: depends on D3.
- Gateway routing/cost/failover: depends on D4.

Do not put controls in the app before the backend can honor them.

## 11. Accessibility and Windows desktop considerations

- Support keyboard navigation for sidebar, composer, activity, and review panels.
- Keep high-contrast status labels in addition to color.
- Avoid icon-only navigation without tooltips and accessible names.
- Keep layout usable at 1366x768 and high-DPI scaling.
- Prevent long paths, hashes, model names, and file names from overflowing.
- Keep reduced-motion support and avoid decorative animation.
- Use Windows-native expectations for open/reveal actions, dialogs, and credential status.

## 12. Staged UI modernization plan

### UI-0 - Keep functional truth and close packaged blocker

Do not redesign around unverified capabilities. Keep File Work Review as `PARTIAL PASS` and diagnose/re-run packaged File Work Review A-L.

### UI-1 - Shell/layout alignment

Status: implemented as the current shell foundation.

Adopt the 1a Airy layout direction in a restrained way: sidebar, conversation, status, and right-side information structure.

### UI-2 - Activity / Plan / Files information architecture

Status: implemented as sections in the right information panel.

Unify activity, plan, files, and File Work Review as real event-backed surfaces.

### UI-3 - Minimal Workspace Navigator + Rich Preview

Start only after packaged A-L passes and Product Owner confirms scope. Begin read-only and preview-first.

### UI-4 - Direct text editing

Add editing only after dirty state, conflict detection, permission semantics, and File Work Review integration are designed.

### UI-5 - External-system tabs when matching backends are ready

Define Structure/RAG, Microsoft 365, dispatch/concurrency, code, and gateway surfaces in a registry as hidden/coming-later slots only. Enable them as real product surfaces only when D1-D4 are accepted.

### UI-6 - Final icons, motion, typography and theme polish

Polish after core capability truth is stable. Do not let visual polish hide partial verification.

## 13. Explicit non-goals

- Do not start Minimal Workspace Navigator as part of this design assessment.
- Do not implement Code/RAG/Microsoft tabs from the PDF in this task.
- Do not expose concurrency controls before D1 exists.
- Do not copy FPT branding, mock user identity, or mock model names.
- Do not claim the PDF is a validated implementation.
- Do not rename the product or change verified acceptance status from reference review.

## 14. Product Owner decisions required

- Keep `1a Airy` as the primary shell direction and avoid expanding beyond integration slots until backend capabilities merge.
- Decide whether `1b Rail` becomes future navigation once D1-D4 surfaces exist.
- Decide whether `1c Zen` is a focus mode or discarded.
- Confirm minimal workspace scope: tree, preview, open/reveal, recent/changed files.
- Decide when direct editing is allowed and what conflict policy is required.
- Decide how future tabs are labelled while dependencies are not ready.
- Confirm branding: Cowork GHC must not inherit FPT reference branding unless ownership is explicit.
