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
| Provider/model/keyring | Đã verify bằng packaged app, còn UX gap | Đã có evidence Windows keyring/provider recovery; interactive pass mới nhất phát hiện gap missing-credential preflight. |
| OpenCode runtime | Đã verify bằng packaged app | Runtime hiện tại là OpenCode; replaceable runtime endpoint vẫn là boundary kiến trúc. |
| Streaming | Đã verify bằng packaged app | Có evidence packaged trước đó; UX pass mới nhất không chạy live streaming. |
| Permissions | Đã verify bằng packaged app, chưa re-verify live ở pass mới nhất | Có evidence packaged Allow/Deny và deny-next-turn; UX pass mới nhất không chạy lại permission modal live. |
| Cancellation | Đã verify bằng packaged app, chưa re-verify live ở pass mới nhất | Có acceptance packaged trước đó; UX pass mới nhất không chạy lại cancel live. |
| Process cleanup | Đã verify bằng packaged app | Không thấy orphan Cowork/OpenCode process sau packaged pass mới nhất. |
| Conversations | Đã verify bằng packaged app | Persistence, sidebar, search, switch, rename/delete qua context menu đã documented. |
| Multi-turn context | Đã verify bằng packaged app | Cowork conversation liên kết nhiều OpenCode runtime turns; không phải native OpenCode continuation sau terminal. |
| Context isolation | Đã verify bằng packaged app | `e40dada` và các packaged tests liên quan verify không leak wrapper trong flow mới. |
| Tool activity | Đã verify bằng packaged app, UX mới nhất chỉ partial-live | Activity timeline đã có; UX pass mới nhất không chạy live tool flow. |
| File changes | Đã verify bằng automation và packaged app, UX còn partial | Có file-change panel/current preview; chưa có full before/after diff. |
| Attachments Phase 1 | Đã verify bằng packaged app nhưng còn blocker | Text files trong workspace, chips, errors, metadata, no raw-content persistence; budget honesty và secret-like policy còn blocker. |
| Skills | Chưa bắt đầu | Chưa available cho end user trong GUI. |
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

- Application shell: packaged Electron desktop shell có local service readiness và
  provider/model status.
- Conversation sidebar: persisted conversations, search, switch, rename/delete qua
  context menu.
- Workspace selection: chọn active workspace, hiển thị current/recent workspace.
- Provider settings: topbar model/status mở provider configuration và keyring state.
- Composer: nhập prompt, send/cancel states, attachment button gated by workspace.
- Attachments: Phase 1 text-file chips, remove, oversized/unsupported error chips,
  metadata persistence.
- Activity panel: tool/activity timeline, permission history, file-change summary.
- Permission presentation: Allow/Deny modal đã có theo packaged evidence trước đó.
- File preview: bounded text preview cho file-change/current content; chưa có full diff.
- Historical continuation: saved conversation có thể reopen và continue qua linked runtime
  turn mới khi cần.

UI hiện ở mức **functional POC quality**, chưa phải release-candidate polish.

## 6. Product gaps đã biết

- Attachment dispatch-budget honesty: UI chưa nói file accepted nào thật sự được included,
  omitted hoặc truncated trong dispatch prompt budget 12k.
- Secret-like attachments: `.env` đang được accepted không warning; `.pem`, `.key` và
  credential-like files cần policy.
- Missing-credential preflight: packaged UI mới nhất cho phép send rồi rơi vào trạng thái
  running/not-connected không rõ recovery.
- Settings modal focus: modal mở ra nhưng focus quan sát được vẫn nằm ở `BODY`.
- Continuation controls trong empty-state DOM: continuation wording tồn tại trong DOM trước
  khi người dùng chọn historical terminal conversation.
- Activity visibility ở narrow/high-DPI: chat vẫn usable, nhưng activity panel có thể gần
  như biến mất mà chưa có affordance rõ.
- Live tool/file/permission GUI verification: chưa hoàn tất trong interactive pass mới nhất.
- Native picker: chưa verify trực tiếp trong pass mới nhất; đã dùng deterministic E2E picker seam.
- Full before/after diff: chưa implement.
- Skills: chưa available cho end users.
- Full installer/release lifecycle: installed artifact, native picker, installed keyring,
  live streaming/tools/permissions/cancel/recovery/relaunch, high-DPI và keyboard pass
  chưa được verify đầy đủ trong một release-candidate pass.

## 7. Roadmap sản phẩm

### Phase A - An toàn và trạng thái trung thực

Entry condition: packaged POC baseline hiện tại sạch và docs đồng thuận về next slice.

Work:
- presentation cho attachment included/omitted budget;
- secret-like file policy;
- missing credential preflight;
- terminal/error recovery sạch;
- settings và empty-state accessibility fixes nhỏ.

Exit acceptance: packaged app hiển thị trung thực attachment inclusion state, block hoặc
xử lý rõ secret-like files, fail fast khi thiếu credential, và không còn các lỗi focus /
empty-state đã biết.

### Phase B - Nền tảng Skills

Entry condition: Phase A có packaged evidence.

Work:
- Skills data model;
- local Skills discovery;
- enable/disable;
- prompt/runtime integration;
- permissions và provenance;
- packaged verification.

Exit acceptance: ít nhất một local Skill có thể được discover, enable, dùng trong packaged
journey, disable và audit/provenance được mà không mở marketplace hoặc cloud scope.

### Phase C - Review công việc trên file

Entry condition: Skills hoặc baseline agent flow có thể làm file work có ý nghĩa.

Work:
- contextual preview;
- create/modify/delete presentation;
- before/after diff;
- phân biệt attachment read với runtime read;
- audit visibility.

Exit acceptance: người dùng hiểu file nào đã được read, created, modified hoặc deleted,
thay đổi cụ thể là gì, và action nào đã được user-approved.

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
| Workspace explorer | Defer. Picker + recent workspace + activity/file preview đủ cho MVP. |
| Preview tab riêng | Defer. Dùng contextual right-panel preview trước. |
| Preview priority | Tool-created/modified files trước; attachment input sau; arbitrary workspace file preview cuối/defer. |
| `.env`, `.pem`, `.key`, credential-like files | Block by default cho MVP; cân nhắc explicit override sau. |
| Before/after diff | Cần trước release candidate; làm sớm hơn nếu Skills làm tăng file edits. |
| Template/workflow replay | Cần Product Owner quyết định; không phải prerequisite cho Skills foundation trừ khi được chọn rõ. |
| User-visible durable audit | Cần Product Owner quyết định; local/internal audit expectation vẫn quan trọng. |

## 10. Operating model phát triển

- Một implementation Agent làm việc trên tree tại một thời điểm.
- Cursor là implementation Agent tiếp theo sau handoff documentation này.
- Codex dùng cho review, audit, takeover hoặc verification khi working tree sạch.
- Claude Code có thể dùng cho focused review, không fan-out rộng.
- Git commit là checkpoint; không dựa vào checkpoint/task state trong `.loop-engineer/`.
- Manual packaged observation có ưu tiên hơn automated reports khi hai nguồn mâu thuẫn.
- GUI polish lớn để gần cuối, sau khi functional truth đã vững.
- Không push remote trừ khi Product Owner yêu cầu.

## 11. Reconcile các plan Claude cũ

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
| Skills / runtime extension | Vẫn planned | Phase B, không marketplace/cloud. |
| MCP/plugins | Deferred | Không nằm trong Skills foundation kế tiếp trừ khi Product Owner ưu tiên. |
| Template/workflow replay | Cần Product Owner quyết định | Giữ là open decision rõ ràng. |
| Folder/image/PDF/Office/drag-drop context | Deferred | Phase D, chỉ làm khi product need rõ. |
| Web/Next.js | Deferred | Non-goal hiện tại. |
| Remote/multi-user/cloud/enterprise | Obsolete cho product hiện tại | Non-goal. |
| Loop Engineer L1-L10 execution model | Superseded | Git + docs + LEAN single-agent model thay thế. |
| VS-01..VS-15 task graph | Superseded | Roadmap active Phase A-G thay thế. |
| OpenWork như source spec | Superseded | Chỉ còn là research reference, không phải source of truth. |
| Full IDE-style workspace explorer | Deferred | Không recommend trước RC. |
