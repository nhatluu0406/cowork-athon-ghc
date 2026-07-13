---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Kế hoạch sản phẩm Cowork GHC

Tài liệu này là **kế hoạch sản phẩm active duy nhất** của Cowork GHC. Hai tài liệu
`cowork-ghc-scope-and-acceptance.md` và `cowork-ghc-master-plan.md` chỉ còn là lịch
sử để đối chiếu yêu cầu cũ.

## 1. Tầm nhìn sản phẩm

Cowork GHC là ứng dụng desktop Windows local-first để người dùng làm việc với một
AI coworker trong workspace trên chính máy của mình. Người dùng chọn một thư mục
local, cấu hình LLM endpoint của họ, trò chuyện với agent, và cho phép agent đọc
hoặc thay đổi file khi cần.

Giá trị chính của sản phẩm là vòng lặp làm việc rõ ràng, có kiểm soát và đáng tin:
workspace là trung tâm, credential nằm trong Windows keyring, mọi hành động file/tool
đều đi qua permission boundary, và UI phải nói trung thực agent đang làm gì. Cowork
GHC thuộc cùng lớp trải nghiệm với Claude Cowork hoặc OpenWork, nhưng không claim
parity hoàn chỉnh và không clone trực tiếp bất kỳ sản phẩm nào.

## 2. Nguyên tắc sản phẩm

- Local-first: dữ liệu workspace và product state mặc định nằm trên máy người dùng.
- Windows-first: packaged Windows desktop app là acceptance surface hiện tại.
- Provider thay thế được: DeepSeek chỉ là provider test hiện tại; core flow không
  phụ thuộc vĩnh viễn vào một endpoint.
- Permission trước mutation: read context không được biến thành quyền sửa/xóa file.
- Lưu credential an toàn: provider keys nằm trong Windows keyring, không đi vào
  docs, logs, screenshots, transcript, localStorage hoặc Git.
- Context có giới hạn: prior turns và attachments đi qua envelope untrusted có budget.
- UI trung thực: không hiển thị ready/done/read/sent nếu state đó chưa được verify.
- Packaged acceptance: acceptance cho user-facing flow ưu tiên packaged app hơn dev server.
- Phát triển tuần tự LEAN: một implementation Agent làm việc trên working tree tại
  một thời điểm, theo slice nhỏ và test tập trung.
- Git + docs là source of truth: commit là checkpoint; `.loop-engineer/` chỉ là
  provenance maintenance-only.

## 3. Baseline hiện tại đã verify

| Năng lực | Trạng thái | Bằng chứng / ghi chú |
|---|---|---|
| Service lifecycle | Đã verify bằng packaged app | `poc-v0.1`; đã có release regression và packaged smoke evidence. |
| Workspace selection | Đã verify bằng packaged app | Workspace picker/recent workspace đã có; audit mới nhất dùng E2E picker seam, native picker vẫn cần pass manual thật. |
| Provider/model/keyring | Đã verify bằng packaged app | Đã có evidence Windows keyring/provider recovery; missing-credential preflight và phân tách local service vs provider status đã verify trong slice Provider Readiness. |
| OpenCode runtime | Đã verify bằng packaged app | Runtime hiện tại là OpenCode; replaceable runtime endpoint vẫn là boundary kiến trúc. |
| Streaming | Đã verify bằng packaged app | Có evidence packaged trước đó; UX pass mới nhất không chạy live streaming. |
| Permissions | Đã verify bằng packaged app, chưa re-verify live ở pass mới nhất | Có evidence packaged Allow/Deny và deny-next-turn; UX pass mới nhất không chạy lại permission modal live. |
| Cancellation | Đã verify bằng packaged app, chưa re-verify live ở pass mới nhất | Có acceptance packaged trước đó; UX pass mới nhất không chạy lại cancel live. |
| Process cleanup | Đã verify bằng packaged app | Không thấy orphan Cowork/OpenCode process sau packaged pass mới nhất. |
| Conversations | Đã verify bằng packaged app | Persistence, sidebar, search, switch, rename/delete qua context menu đã documented. |
| Multi-turn context | Đã verify bằng packaged app | Cowork conversation liên kết nhiều OpenCode runtime turns; không phải native OpenCode continuation sau terminal. |
| Context isolation | Đã verify bằng packaged app | `e40dada` và các packaged tests liên quan verify không leak wrapper trong flow mới. |
| Tool activity | Đã verify bằng packaged app, UX mới nhất chỉ partial-live | Activity timeline đã có; UX pass mới nhất không chạy live tool flow. |
| File changes | PARTIAL PASS for current File Work Review slice | File-change panel + persisted before/after review, bounded diff, attachment vs runtime read split; implementation/regression/package build pass, but packaged live A–L has not passed yet. Open-file remains deferred. |
| Skills Foundation Phase 1 | Đã verify bằng packaged app | Local `SKILL.md` discovery, validation, enable/disable, provenance và bounded dispatch; không executable/MCP/marketplace/cloud. |
| Installer/release | Verify một phần | Có packaged POC; chưa hoàn tất installed artifact/keyring/native picker/live GUI release lifecycle. |
| Web / Next.js | Deferred | Không bắt đầu hiện tại. |

## 4. Kiến trúc hiện tại

```text
Electron renderer
-> preload/shell bridge
-> local service
-> OpenCode runtime
-> replaceable LLM endpoint
```

Renderer sở hữu GUI, không trực tiếp mutate filesystem. Preload/shell bridge chỉ expose
những capability desktop hẹp. Local service sở hữu product logic, workspace guards,
conversation state, provider settings và runtime orchestration. OpenCode là agent
runtime hiện tại. LLM endpoint có thể thay thế theo provider.

Cowork conversation là identity dài hạn của sản phẩm: transcript, workspace,
provider/model, activity, file-change history và permission history. Một Cowork
conversation có thể chứa nhiều OpenCode runtime turns được liên kết. Khi một OpenCode
runtime session đã terminal, Cowork GHC tạo runtime turn mới cùng conversation và gửi
bounded untrusted context; sản phẩm không claim native OpenCode continuation sau terminal.

## 5. UX baseline hiện tại

- Application shell: hybrid `1a Airy + 1b rail` direction — 56px product rail,
  contextual conversation/workspace sidebar, main chat workspace, and right information
  panel — while preserving **local service readiness** and
  **provider/model status** as separate real states.
- Conversation sidebar: persisted conversations, search, switch, rename/delete qua
  context menu.
- Workspace selection: chọn active workspace, hiển thị current/recent workspace.
- Provider settings: topbar model/status mở provider configuration và keyring state.
- Composer: nhập prompt, send/cancel states, attachment button gated by workspace.
- Attachments: Phase 1 text-file chips, remove, oversized/unsupported error chips,
  metadata persistence.
- Activity panel: real data-backed Kế hoạch, Hoạt động, Tệp, and Xem lại thay đổi
  sections; File Work Review remains in this right information panel.
- Permission presentation: Allow/Deny modal đã có theo packaged evidence trước đó.
- Workspace Navigator: read-only active workspace tree through the service boundary;
  direct children only, lazy folder expansion, name filter over loaded entries, refresh,
  and selected-file preview in the right `Tệp` tab.
- File preview/review: bounded text preview plus persisted before/after File Work Review diff for agent file work; open file, reveal in Explorer, direct editor, Office/PDF/image preview, and universal Preview tab are not current capabilities.
- Historical continuation: saved conversation có thể reopen và continue qua linked runtime
  turn mới khi cần.

UI hiện là **commercial UI foundation** for D1-D4 merge work, not release-candidate
polish. D1-D4 surfaces are registry slots only, visible in `awaiting_integration`
state with dependency-specific copy, and do not display mock production data.

## 6. Product gaps đã biết

- Live tool/file/permission GUI verification: chưa hoàn tất trong interactive pass mới nhất.
- Native picker: chưa verify trực tiếp trong pass mới nhất; đã dùng deterministic E2E picker seam.
- File Work Review packaged live A–L: not PASS yet. Implementation, release regression, and Windows package build pass; live packaged journeys remain the current blocker.
- Skills ecosystem ngoài Phase 1 chưa có: marketplace, MCP, executable plugin, cloud catalog,
  URL install và full Skill editor đều deferred.
- Full installer/release lifecycle: installed artifact, native picker, installed keyring,
  live streaming/tools/permissions/cancel/recovery/relaunch, high-DPI và keyboard pass
  chưa được verify đầy đủ trong một release-candidate pass.

## 7. Roadmap sản phẩm

### Phase A - An toàn và trạng thái trung thực

**Trạng thái: CLOSED** (packaged POC scope, 2026-07-12).

Entry condition: packaged POC baseline hiện tại sạch và docs đồng thuận về next slice.

Work (đã hoàn tất):
- presentation cho attachment included/omitted budget;
- secret-like file policy;
- missing credential preflight;
- terminal/error recovery sạch;
- settings và empty-state accessibility fixes nhỏ.

Exit acceptance: packaged app hiển thị trung thực attachment inclusion state, block hoặc
xử lý rõ secret-like files, fail fast khi thiếu credential, và không còn các lỗi focus /
empty-state đã biết — **đạt** qua `attachment-honesty-packaged.mjs` và `provider-readiness-packaged.mjs`.

### Phase B - Nền tảng Skills

**Trạng thái: PHASE 1 PASS** (packaged A–J, 2026-07-12).

Entry condition: Phase A có packaged evidence.

Work đã hoàn tất trong Phase 1:
- `SKILL.md` local instruction-only model;
- bounded built-in + app-managed user-local discovery;
- validation + enable/disable persistence;
- prompt/runtime instruction envelope;
- per-turn hash/version/source provenance;
- permission isolation và packaged verification.

Exit acceptance: ít nhất một local Skill có thể được discover, enable, dùng trong packaged
journey, disable và audit/provenance được mà không mở marketplace hoặc cloud scope — **đạt**.

Không thuộc Phase 1: executable plugins, MCP, marketplace, cloud, URL install, Skill editor,
workspace auto-scan và template/workflow replay.

### Phase C - Review công việc trên file

**Trạng thái: PARTIAL PASS.** Implementation, unit/release regression, and Windows package
build pass. Packaged live journeys A–L have not passed yet, so Phase C must not be
called complete.

Entry condition: Skills hoặc baseline agent flow có thể làm file work có ý nghĩa.

Work:
- contextual preview;
- create/modify/delete presentation;
- before/after diff;
- phân biệt attachment read với runtime read;
- audit visibility.

Exit acceptance: người dùng hiểu file nào đã được read, created, modified hoặc deleted,
thay đổi cụ thể là gì, và action nào đã được user-approved.

Current implementation action before any next product slice:

```text
Diagnose and re-run packaged File Work Review A–L
```

### Phase D - Mở rộng context

Entry condition: có product need rõ ràng và Phase A attachment honesty đã hoàn tất.

Work, chỉ làm khi cần:
- folder context;
- PDF;
- image;
- Office document;
- drag-and-drop.

Exit acceptance: mỗi context type được thêm phải có size/type validation có giới hạn,
workspace guarding, metadata semantics và packaged verification. Không mặc định build tất cả.

### Phase E - Full packaged release verification

Entry condition: release-candidate feature surface đã frozen cho một pass.

Work:
- live streaming;
- tools;
- permission approve/deny;
- cancellation;
- provider recovery;
- continuation;
- relaunch;
- installed keyring;
- process cleanup;
- native picker;
- high-DPI và keyboard pass.

Exit acceptance: một packaged journey được documented rõ, phân biệt direct manual/native/live
observations với automation-only evidence, và không để lại orphan processes.

### Phase F - Polish UX cuối

Entry condition: functional states đã trung thực và release-blocking UX gaps đã đóng.

Work:
- icons phục vụ nhận biết file/status/action;
- minimal functional animation cho streaming/tool/cancel/loading;
- spacing, typography, color;
- empty/loading/error state consistency.

Exit acceptance: polish giúp comprehension tốt hơn mà không thêm decorative motion hoặc
feature scope mới.

### Phase G - Phân phối

Entry condition: release-candidate verification đủ xanh để package cho user.

Work:
- installer;
- versioning;
- upgrade;
- uninstall;
- migration;
- release candidate.

Exit acceptance: install, upgrade, uninstall, keyring, workspace state và cleanup behavior
được verify trên Windows, không leak secret hoặc user data.

## 8. Non-goals rõ ràng

- Không khôi phục full Loop Engineer workflow.
- Không dùng fan-out/subagents mặc định cho implementation.
- Không biến Cowork GHC thành IDE clone.
- Không build full workspace explorer trước khi có evidence về product need.
- Không thêm universal Preview tab trong MVP.
- Không bắt đầu web/Next.js hiện tại.
- Không thêm cloud sync hoặc multi-user mode.
- Không build marketplace/cloud trong Skills foundation.
- Không kế thừa OpenWork features trừ khi Product Owner explicit nhận vào Cowork GHC.

## 9. Product Owner decisions

| Decision | Khuyến nghị hiện tại |
|---|---|
| Workspace explorer | Minimal Workspace Navigator read-only đã triển khai theo Product Owner brief; không phải IDE/editor. |
| Preview tab riêng | Defer. Dùng contextual right-panel `Tệp` preview trước. |
| Preview priority | Tool-created/modified files và selected workspace text file dùng bounded preview; Office/PDF/image/direct editing vẫn deferred. |
| `.env`, `.pem`, `.key`, credential-like files | Block by default cho MVP; cân nhắc explicit override sau. |
| Before/after diff | Implemented for File Work Review, but the slice remains PARTIAL PASS until packaged live A–L passes. |
| Template/workflow replay | Cần Product Owner quyết định; không phải prerequisite cho Skills foundation trừ khi được chọn rõ. |
| User-visible durable audit | Cần Product Owner quyết định; local/internal audit expectation vẫn quan trọng. |

## 10. Định hướng trải nghiệm workspace sau MVP

Các capability dưới đây là hướng phát triển dài hạn. **Không** nằm trong scope Skills
Foundation Phase 1 và không khóa layout UI cuối. Minimal Workspace Navigator đã bắt đầu
ở read-only scope; các phần còn lại vẫn planned direction, not current product capability.

### Minimal Workspace Navigator

- Danh sách file/folder trong active workspace: **implemented read-only**.
- Icon loại file: **implemented for common file/folder distinction**.
- Search/filter: **implemented as filter over loaded entries**.
- Recent và changed files: **segmented filter UI** (`Tất cả | Gần đây | Đã đổi`) with `modifiedTime` heuristics; full recent/changed API deferred.
- Không biến ứng dụng thành IDE clone: still enforced.

### Rich File Viewing

- Xem text/Markdown/source.
- Image và PDF.
- Office preview khi có pipeline phù hợp.
- Open file bằng ứng dụng mặc định của Windows.
- Contextual preview/diff cho file agent tạo hoặc sửa.

Capability quan trọng hơn layout cuối — không bắt buộc phải là một tab `Preview` riêng.

### Direct Editing

- Text/Markdown/source editing trước.
- Save/discard/undo.
- Dirty state.
- Conflict detection khi file thay đổi bên ngoài.
- Office embedded editing **chưa cam kết**.

### Office Direction

Phân biệt rõ:

```text
Office context/read
Office preview
Open in native Office app
AI-assisted modification
Embedded manual Office editing
```

Chỉ ba capability đầu và **AI-assisted modification** là hướng phát triển có thể cân nhắc sau.
Cowork GHC **không** cam kết xây một Office editor hoàn chỉnh trong sản phẩm.

## 11. Future UI direction from reference assessment

Reference assessment:
[Cowork Frontend Design Assessment](../references/cowork-frontend-design-assessment.md)

Recommended shell direction: hybrid `1a Airy + 1b rail`, **now ported as UI Shell V3**
(`app/ui/src/ui-shell/`) before D1-D4 merge work: product rail, Cowork/Workspace work modes,
main workspace (chat or file preview), optional inspector, bottom status bar. This does **not**
change File Work Review acceptance, which remains PARTIAL PASS. `1c Zen` is only suitable as focus-mode
or empty-state inspiration.

Important constraints:

- The PDF is visual reference, not source of truth.
- Do not copy FPT branding, mock identities, or mock model names.
- Do not show Code, Structure/RAG, Microsoft 365, or concurrency controls as real product
  capability before matching backend systems exist.
- Use the surface registry for top-level product surfaces; do not hardcode navigation
  in scattered components.
- Capability is more important than a fixed tab name; a workspace panel or right-side view
  may be better than a universal `Preview` tab.

Current UI foundation:

| Area | Status |
|---|---|
| Cowork shell | Available, implemented with product rail, contextual sidebar, central chat, and right information panel. |
| Surface registry | Defines `cowork`, `dispatch`, `gateway`, `knowledge`, `knowledge-graph`, `microsoft`, `code` as the navigation source of truth. |
| D1-D4 slots | UI contracts only; no backend adapters, no fake production data, visible as awaiting integration. |
| File Work Review | Existing surface preserved; still PARTIAL PASS until packaged C-L acceptance passes. |
| Minimal Workspace Navigator | Implemented read-only through service boundary. |

## 12. Hệ thống song song do team khác phát triển

These tracks are external parallel systems expected from other teams. They are not folded
into the sequential Cowork GHC roadmap A-G, and Cowork GHC must not claim them as current
capability until integration acceptance passes.

| ID | Capability | External owner/team status | Current in Cowork GHC | Boundary Cowork GHC must keep | Future UI surface | Prerequisites | Security considerations | Integration acceptance | Fallback | Frontend dependency |
|---|---|---|---|---|---|---|---|---|---|---|
| D1 | Dispatch / fan-out agent | External team expected; specific owner not recorded in active docs. | Not implemented. Development and runtime baseline remain LEAN single-agent. | Adapter for task dispatch, child task status, cancellation, permission aggregation, resource/concurrency limits, and result provenance. | Concurrency controls, child task list, dispatch status, multi-agent progress. | Backend dispatch service, cancellation contract, resource limits, permission aggregation, provenance schema. | Prevent runaway parallel work, preserve user approval, isolate child outputs, audit resource use. | Packaged flow shows child tasks, cancellation, permission aggregation, failure recovery, and provenance without bypassing baseline permissions. | Direct single-agent provider/runtime flow. | Do not expose concurrency controls until D1 exists. |
| D2 | Microsoft automation: Teams, SharePoint, OneDrive, Graph | External team expected; specific owner not recorded in active docs. | Not implemented. Reference webhook/filesystem ideas are not Graph integration. | Connector boundary for Graph/Teams/SharePoint/OneDrive with explicit auth, consent, least-privilege scopes, audit trail, credential isolation, and status/error surface. | Microsoft 365 tab, connector status, selected workspace/cloud file actions. | Microsoft app registration, auth/user consent, Graph scopes, audit model, connector lifecycle, test tenants. | Least privilege, token isolation, tenant/user consent, sensitive document handling, auditability. | Packaged integration proves auth, consent, scoped action, error/status, revocation, and no token leakage. | Local workspace files and manual user export/import. | Microsoft 365 tab only enabled when D2 is accepted. |
| D3 | Knowledge system: RAG, vector, graph | External team expected; specific owner not recorded in active docs. | Not implemented as accepted backend. | Ingestion/index boundary, workspace opt-in, source provenance, stale-index handling, replaceable vector/graph backend, and local/remote data policy. | Structure/RAG tab, graph explorer, source-backed answers. | Indexer, storage policy, provenance schema, stale-index invalidation, retrieval API, packaged verification. | No silent indexing of private workspaces, source provenance on answers, local/remote data disclosure, redaction policy. | Packaged flow proves opt-in ingestion, retrieval with citations, stale index behavior, deletion/cleanup, and backend replaceability. | Direct workspace context and attachments only. | Structure/RAG tab only enabled when D3 is accepted. |
| D4 | Advanced LLM gateway: key pool, rotation, load balance, failover, cost routing | External team expected; specific owner not recorded in active docs. | Not implemented. Current provider abstraction remains baseline. | Gateway adapter while preserving simple direct-provider fallback, key pool/rotation, load balance/failover, cost/routing metadata, health and error semantics, and secret isolation. | Gateway health, routing/cost settings, provider diagnostics. | Gateway API contract, health semantics, key isolation, routing metadata, cost reporting, fallback behavior. | Keep keys out of renderer/transcripts/logs, avoid leaking routing decisions, define failover transparency. | Packaged flow proves direct provider fallback, gateway routing, failure semantics, health reporting, and no credential leakage. | Current direct provider abstraction. | Gateway settings appear only when D4 is accepted. |

UI tabs shown in the frontend PDF are therefore future surfaces. The current shell
foundation defines registry entries and passive integration contracts for them, but only
`cowork` is available by default. Dispatch, Gateway, Knowledge, Knowledge Graph, and
Microsoft 365 are visible but awaiting D1-D4 integration; Code is planned. Structure/RAG,
Microsoft 365, dispatch concurrency, and advanced gateway controls still depend on D1-D4
acceptance before showing real data or controls.

## 13. Operating model phát triển

- Một implementation Agent làm việc trên tree tại một thời điểm.
- Cursor là implementation Agent tiếp theo sau handoff documentation này.
- Codex dùng cho review, audit, takeover hoặc verification khi working tree sạch.
- Claude Code có thể dùng cho focused review, không fan-out rộng.
- Git commit là checkpoint; không dựa vào checkpoint/task state trong `.loop-engineer/`.
- Manual packaged observation có ưu tiên hơn automated reports khi hai nguồn mâu thuẫn.
- GUI polish lớn để gần cuối, sau khi functional truth đã vững.
- Không push remote trừ khi Product Owner yêu cầu.

## 14. Reconcile các plan Claude cũ

| Requirement / theme từ plan cũ | Phân loại | Cách xử lý trong plan active |
|---|---|---|
| Local Windows desktop app | Đưa vào plan active | Nằm trong tầm nhìn, nguyên tắc, kiến trúc và roadmap. |
| Workspace picker, recent workspace, path confinement | Đưa vào plan active | Baseline + Phase E native picker verification; explorer deferred. |
| Permissioned file/tool actions | Đưa vào plan active | Nguyên tắc sản phẩm và Phase C/E verification. |
| Provider-neutral model với Windows keyring | Đưa vào plan active | Nguyên tắc, kiến trúc, baseline, Phase E. |
| Conversation persistence và multi-turn | Đã hoàn tất | Baseline ghi rõ Cowork linked runtime turns. |
| Streaming, cancellation, provider recovery | Đã hoàn tất / pass mới nhất chỉ verify một phần | Giữ evidence packaged trước đó; Phase E yêu cầu full latest live pass. |
| Tool activity và file mutations | Đã hoàn tất / vẫn planned cho review quality | Panel hiện có + Phase C diff/audit improvements. |
| Local audit events | Vẫn planned | Product Owner quyết định phần user-visible durable audit; audit visibility ở Phase C. |
| Skills / runtime extension | Phase 1 hoàn tất | Instruction-only local Skills; ecosystem/plugin/MCP vẫn deferred. |
| MCP/plugins | Deferred | Không nằm trong Skills Phase 1; chỉ làm khi Product Owner ưu tiên riêng. |
| Template/workflow replay | Cần Product Owner quyết định | Giữ là open decision rõ ràng. |
| Folder/image/PDF/Office/drag-drop context | Deferred | Phase D, chỉ làm khi product need rõ. |
| Dispatch / fan-out agent (D1) | External parallel track | Not current Cowork GHC capability; future adapter boundary only. |
| Microsoft automation (D2) | External parallel track | Not current Cowork GHC capability; Microsoft 365 UI requires real Graph/Teams/SharePoint/OneDrive integration. |
| Knowledge RAG/vector/graph (D3) | External parallel track | Not current Cowork GHC capability; Structure/RAG UI requires accepted backend. |
| Advanced LLM gateway (D4) | External parallel track | Not current Cowork GHC capability; current direct provider abstraction remains fallback. |
| Web/Next.js | Deferred | Non-goal hiện tại. |
| Remote/multi-user/cloud/enterprise | Obsolete cho product hiện tại | Non-goal. |
| Loop Engineer L1-L10 execution model | Superseded | Git + docs + LEAN single-agent model thay thế. |
| VS-01..VS-15 task graph | Superseded | Roadmap active Phase A-G thay thế. |
| OpenWork như source spec | Superseded | Chỉ còn là research reference, không phải source of truth. |
| Full IDE-style workspace explorer | Deferred | Không recommend trước RC. |
