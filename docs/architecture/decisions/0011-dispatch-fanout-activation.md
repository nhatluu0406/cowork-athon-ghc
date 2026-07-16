---
language: "vi"
status: "accepted"
date: "2026-07-16"
deciders: ["product-owner", "runtime-llm-engineer"]
related: ["0010-remote-gateway-and-pwa-surface.md", "0005-provider-abstraction.md", "0003-local-service-transport-placement-loopback.md"]
---

# ADR 0011 — Kích hoạt Dispatch / fan-out (D1), superseding phạm vi boundary-only

## Context

`docs/architecture/cowork-ghc-implementation-design.md` bị **FROZEN ở L4 (2026-07-11)**; header của nó
(`:3-8`) ghi rõ: *"Changing a frozen decision requires a superseding ADR."* Hai chỗ khóa D1:

- §7 (`docs/architecture/cowork-ghc-implementation-design.md:156-157`): *"**D1 Dispatch / fan-out** —
  a `DispatchPort` seam over the session context; POC exposes the seam shape only."*
- §10 traceability (`:232`): `| D1–D4 | port seams, boundary-only (§7) |`.

Thực tế đã đi xa hơn quyết định đóng băng đó. Product Owner chốt tại `review/idea.md` Clarification 3
(`review/idea.md:37-44`, 2026-07-14): Q2 (`:40`) yêu cầu **trigger task có sẵn từ điện thoại** +
1-touch template reuse + workflow builder từ prompt (draft phải confirm, không bao giờ auto-run);
Q3 (`:41`) chốt fan-out **mặc định 3, `maxConcurrency` per task, trần cứng 5 enforce ở service**;
Q5 (`:39`) chốt Discord không được `approve` hành động ghi file. Theo đó, Phase 4–5 của
`agent-harness-plan.md` đã ship **fan-out chạy thật** (không còn là seam shape) qua các commit
`c8dd441` (loop runner), `4b8512b` (wire fan-out vào composition), `624fa51` (dispatch board +
`/dispatch`), `878c1f9` (verify hook + Task 4.3 + PWA dispatch board), `6058b74` (status).

Khoảng trống compliance: **implementation vượt một quyết định đã đóng băng mà không có ADR
superseding**. ADR này đóng khoảng trống đó — nó ghi lại quyết định đã thực thi, không xin phép lại.

## Decision

### 1. Kích hoạt D1: từ "seam shape only" thành fan-out execution thật, in-process

**Trong scope (đã build, là quyết định được ghi ở đây):**

- `TaskDefinition` / `AgentDefinition` / `LoopPolicy` / `FanOutBranch` là **data contract** trong
  `core/contracts/src/dispatch.ts`, validate ở boundary (AD-6, `agent-harness-plan.md:111-113`).
- Loop runner (`service/src/tasks/loop-runner.ts`): `run_once` / `retry_until_verified` /
  `scheduled` + guardrails.
- Fan-out orchestrator (`service/src/dispatchers/fanout.ts`): bounded concurrency + aggregation +
  group cancel; **orchestrate tại service**, không bật `task` trong OpenCode child (AD-5,
  `agent-harness-plan.md:108-110`).
- Run registry + HTTP boundary: `service/src/dispatchers/run-registry.ts`,
  `service/src/dispatchers/router.ts` (`/v1/dispatch/*`, token-guarded).
- Live branch runner (`service/src/dispatchers/live-branch-runner.ts`): **một branch = một child
  session THẬT**, qua đúng session service + prompt seam + MỘT permission gate hiện có.
- Workflow builder từ prompt (`service/src/tasks/workflow-builder.ts` + `workflow-router.ts`):
  draft → validate → confirm riêng mới lưu.
- Dispatch board desktop + PWA (đọc + 1-touch run + cancel).

**Ngoài scope (chưa build — không được đọc ADR này như đã có):** worktree-per-child isolation;
slot system prompt per-session ở child seam; áp `permissionPreset` / `skillIds` / `model` của agent
tại thời điểm dispatch (xem §3 và Consequences); persist dispatch run qua restart; D4 key pool.

**Phạm vi superseding — hẹp và tường minh:** ADR này supersede **CHỈ dòng D1** ở §7 (`:156-157`) và
**chỉ phần D1** của dòng traceability §10 (`:232`). D3 (`KnowledgePort`) và D4 (LLM gateway) **vẫn
boundary-only** — đã verify bằng grep repo-wide 2026-07-16: `KnowledgePort` không tồn tại trong code,
hit duy nhất là chính design doc. D2 **không** còn boundary-only trên thực tế (foundation MS365
flag-gated, `docs/product/current-status.md:149-215`) nhưng đó **không phải chủ đề của ADR này** và
cần ADR riêng — ghi ở Open items. Phần còn lại của design đóng băng **không đổi**: loopback-only
(ADR 0003), một permission gate ở execution boundary (§5), một credential store (§6), một owner cho
mỗi child lifecycle (ADR 0004). **Không ADR 0001–0006 nào bị sửa**, nên Loop L4 giữ `COMPLETED`.

### 2. Seam naming + traceability: `BranchRunner` là canonical, `DispatchPort` là nhãn superseded

`DispatchPort` **không tồn tại ở bất kỳ đâu trong code** — verify bằng grep repo-wide (2026-07-16):
hit duy nhất là `docs/architecture/cowork-ghc-implementation-design.md:156`. Để traceability không
mất im lặng, ghi lại ánh xạ **design name → real symbol → file**:

| Design (§7) | Symbol thật | File |
|---|---|---|
| `DispatchPort` (seam over session context) | `BranchRunner` (type: `(plan, signal) => Promise<BranchRunResult>`) | `service/src/dispatchers/fanout.ts:53` |
| — (concurrency + aggregation) | `createFanOutOrchestrator` | `service/src/dispatchers/fanout.ts:130` |
| — (run identity / lifecycle / view) | `DispatchRunRegistry` | `service/src/dispatchers/run-registry.ts:61` |
| — (HTTP boundary) | `createDispatchRouter`, `/v1/dispatch/*` | `service/src/dispatchers/router.ts:14-17,30` |
| — (Tier 1 honest default) | `notAttachedBranchRunner` | `service/src/composition/tier2-seams.ts:117-122` |
| — (Tier 2 live) | `createLiveBranchRunner` | `service/src/dispatchers/live-branch-runner.ts:65` |
| — (wiring) | `createDispatchRunRegistry(...)` / `branchRunner` | `service/src/composition/compose-service.ts:289-296,384`; `service/src/composition/compose-live.ts:174-196` |

**Chốt option (a): `BranchRunner` là tên canonical; `DispatchPort` là nhãn design-doc đã superseded.**
Lý do: (i) tên `DispatchPort` chưa bao giờ tồn tại trong code — không có chi phí rename, không có
alias phải nuôi; (ii) seam thật **hẹp và trung thực hơn** một "Port": nó là một function type trên
**một branch**, còn các trách nhiệm mà design gộp vào "DispatchPort" thực tế tách thành 4 module,
mỗi module một trách nhiệm (`coding.md`: một responsibility/module); (iii) thêm alias trong
`core/contracts` chỉ để khớp một nhãn tài liệu là abstraction không mang giá trị
(`architecture.md`: "Avoid abstractions that carry no value").

Lưu ý va chạm tên: `app/ui/src/dispatch-plan.ts` là assembly attachment/transcript cho composer —
một nghĩa "dispatch" **khác**, không liên quan D1 fan-out; AD-7 (`agent-harness-plan.md:114-116`)
vẫn còn mở.

### 3. Guardrails khiến việc kích hoạt là an toàn

- **Concurrency**: `FANOUT_DEFAULT_CONCURRENCY = 3` (`core/contracts/src/dispatch.ts:86`),
  `FANOUT_HARD_CAP = 5` (`:88`); `maxConcurrency` per task bị clamp ngay lúc validate
  (`:275-277`) và lúc resolve (`effectiveConcurrency`, `:283-286`); orchestrator dùng đúng giá trị
  đó cho worker pool (`service/src/dispatchers/fanout.ts:135,186`). Số nhánh cũng chặn ở
  `MAX_BRANCHES = 5` (`core/contracts/src/dispatch.ts:95`, enforce `:225-227`). Trần **enforce ở
  service**, không tin client (Q3, `review/idea.md:41`).
- **Permission preset narrowing-only**: `isNarrowingPreset` (`core/contracts/src/dispatch.ts:109-122`)
  từ chối bất kỳ preset nào **nới** so với base; `validateAgentDefinition` enforce (`:188-190`).
  Base là `LIVE_SESSION_PERMISSION_POLICY` (`service/src/runtime/opencode-config.ts:30-46`), áp cho
  built-in lúc boot (`service/src/agents/catalog.ts:78-81`), cho user agent (`:98`, `:120-125`), và
  cho agent do LLM đề xuất trong workflow draft (`service/src/composition/compose-service.ts:305`).
  **Giới hạn trung thực**: preset hiện **chỉ được validate, chưa được áp per-branch lúc chạy** —
  `permissionPreset` không có call site nào ngoài validation (grep), và `BranchPlan` chỉ mang
  `systemPrompt` + `prompt` (`service/src/dispatchers/fanout.ts:22-28`). Hệ quả: một branch **không
  bao giờ có nhiều quyền hơn** live policy (không leo thang), nhưng phần **siết** mà agent khai báo
  (ví dụ built-in `reviewer` khai `{ edit: "deny" }`, `service/src/agents/builtins.ts:20,40`) **chưa
  được enforce** — branch rơi về `edit: "ask"` của live policy và đi qua gate hỏi user. Xem Open items.
- **MỘT permission gate ở execution boundary, không phải per-branch UI**: fan-out được orchestrate ở
  service; `task: "deny"` giữ nguyên trong child policy (`service/src/runtime/opencode-config.ts:41`)
  nên child không tự spawn sub-agent vượt gate; live branch runner **không thêm đường permission thứ
  hai** (`service/src/dispatchers/live-branch-runner.ts:1-11`), permission của mọi branch đi qua
  permission bridge trên event pump (`service/src/composition/compose-live.ts:213-220`) vào cùng một
  `permissionGate` mà desktop/PWA/Discord đọc (`compose-live.ts:297-315`) — AD-4
  (`agent-harness-plan.md:105-107`).
- **`retry_until_verified` chỉ `verified` khi có bằng chứng file/disk thật**: loop runner bắt buộc có
  hook, thiếu hook thì `errored` ngay (`service/src/tasks/loop-runner.ts:159-162`); chỉ trả
  `completed` khi hook xác nhận (`:174-177`); hết `maxTurns` mà chưa verified là **`exhausted`**
  (`:167-169`), guardrail/cancel là `cancelled`/`exhausted` (`:133-139`) — **không bao giờ**
  `completed` giả. Hook thật (`service/src/tasks/verify-file-evidence.ts:42-63`) trả `verified: false`
  khi: attempt không `completed` (`:43`), không khai path nào (`:46`), không có workspace (`:49`),
  hoặc bất kỳ path nào không có trên đĩa / check ném lỗi (`:51-60`). Wire ở
  `service/src/composition/compose-service.ts:292-294`; nguồn "khai báo" là EV `file_mutation` thật
  của session (`compose-live.ts:191-195`) và vẫn được hook **re-confirm trên đĩa**.
- **Workflow draft phải confirm, không bao giờ auto-run**: builder không chạm task store / run
  registry (`service/src/tasks/workflow-builder.ts:1-20`); route draft chỉ trả 200/422 và không
  persist (`service/src/tasks/workflow-router.ts:61-66`); confirm là bước riêng, **re-validate** qua
  đúng catalog/store rồi mới lưu, và **không start run nào** (`:70-87`). Output LLM là input không
  tin cậy: field lạ bị từ chối trước cả validator (`workflow-builder.ts:81-101`); Tier 1 generator
  từ chối trung thực thay vì bịa (`service/src/composition/tier2-seams.ts:132-134`).
- **Route từ phone chỉ read + 1-touch run + cancel**: GET allowlist là task catalog + runs list/get
  (`service/src/remote-gateway/gateway.ts:132-141`); POST allowlist chỉ có run một task **đã lưu** và
  cancel một run (`:158-167`); mọi thứ khác 404, không bao giờ forward (`:142`, `:241-243`) — không có
  route create/update/delete task từ phone. Router dispatch chỉ chạy task **đã lưu**, không nhận
  `TaskDefinition` inline (`service/src/dispatchers/router.ts:1-5,39-42`). Discord: `approve` bị từ
  chối trong adapter (`service/src/remote-gateway/discord/adapter.ts:100-104`) theo Q5
  (`review/idea.md:39`).

## Consequences

- (+) Fan-out thật mà **không đẻ cơ chế song song**: dùng lại session service, prompt seam, permission
  gate, và stream hub sẵn có; một nguồn sự thật cho session content vẫn là OpenCode store (ADR 0001).
- (+) Trung thực theo cấu trúc: một branch fail không biến group thành success bịa
  (`fanout.ts:119-128`); Tier 1 không có child thì branch `errored` thật (`tier2-seams.ts:117-122`);
  `exhausted ≠ completed`.
- (−) **Chưa có packaged/live verification.** Checkpoint 5 (`agent-harness-plan.md:364-366`) **chưa bắt
  đầu** (`docs/product/current-status.md:122-124`). Bằng chứng hiện tại là unit/integration với fake
  seam (`current-status.md:103-104,118`); chưa chạy fan-out với OpenCode child + LLM thật. Full suite
  chưa chạy (`:118`), và repo có lỗi pre-existing ở suite khác (`:180-188`) — ADR này **không** tuyên
  bố bất kỳ trạng thái green nào ngoài phần đã ghi.
- (−) **Chặn Checkpoint 5: cần provider hợp lệ.** Gateway `http://127.0.0.1:8080` của user bị SSRF
  policy từ chối (`scheme_not_https`) — `current-status.md:125-128,145-147`. Cần endpoint https, hoặc
  quyết định nới policy http-on-loopback **kèm ADR riêng**; đường deterministic là
  `COWORK_GHC_E2E_MOCK_LLM_BASE_URL`.
- (−) **Child seam không có slot system prompt per-session** → persona agent được **ghép vào đầu
  message** (`service/src/dispatchers/live-branch-runner.ts:45-47`, `current-status.md:105-106`). Đây
  là shaping, **không phải** một security boundary.
- (−) `permissionPreset` / `skillIds` / `model` của agent **chưa được áp per-branch** (xem Decision §3).
- (−) Dispatch run là **in-memory**: registry là một `Map` per-launch, history bounded 20
  (`service/src/dispatchers/run-registry.ts:89,94,112-118`) → run không sống qua restart; loop
  `scheduled` chết theo process.
- (−) **Chi phí/token của fan-out thật chưa đo** (`current-status.md:129`); mức 3/5 là phán đoán chống
  HTTP 429 khi chưa có D4 key pool (`agent-harness-plan.md:345-347`), **chưa** được validate với quota thật.
- (−) Các branch đồng thời **dùng chung một workspace** (chưa có worktree isolation) → rủi ro ghi đè
  lẫn nhau chưa được xử lý.
- (~) **Khác ADR 0010 và MS365: D1 KHÔNG flag-gated.** `/v1/dispatch/*` luôn được mount
  (`service/src/composition/compose-service.ts:384`), nên baseline **có** thay đổi so với "nothing
  built" của design đóng băng. Bù lại, không có child thì mọi branch báo lỗi trung thực chứ không giả
  vờ chạy.
- **Reviewer gate vẫn bắt buộc**: Task 6.3 — independent review (security + release-verifier) — là
  bắt buộc vì slice này chạm network exposure + process lifecycle (`agent-harness-plan.md:375-376`,
  risk row `:406`). ADR này **không** thay thế review đó.

## Alternatives considered

- **Giữ boundary-only (không kích hoạt)** — **bị loại**: PO yêu cầu trigger task từ điện thoại
  (Q2, `review/idea.md:40`); một "seam shape" không chạy được gì, nên yêu cầu sản phẩm không thể đáp
  ứng nếu giữ nguyên §7.
- **Bật `task` tool của OpenCode để model tự spawn sub-agent** — **bị loại** (AD-5,
  `agent-harness-plan.md:108-110`): fan-out sẽ nằm **bên trong** child, vượt qua một permission gate
  và khỏi tầm nhìn trung thực; giữ `task: "deny"` (`service/src/runtime/opencode-config.ts:41`).
- **External orchestrator / worktree-per-child** — **ghi nhận là design option, không chọn cho POC**:
  plan Task 5.2 (`agent-harness-plan.md:348-350`) mô tả mỗi session con một git worktree riêng (tham
  chiếu `claude remote-control --spawn worktree`), yêu cầu workspace là git repo + fallback same-dir.
  Không chọn vì chưa có lợi ích rõ ở POC và làm phức tạp supervision; chi phí là rủi ro ghi đè ở trên.
- **Nhận `TaskDefinition` inline trên route run** — **bị loại**: router chỉ chạy task đã lưu, để mọi
  thứ chạy được đều đã qua validation của store (`service/src/dispatchers/router.ts:1-5`).

## Requirements traceability

- Design §7 dòng D1 (`docs/architecture/cowork-ghc-implementation-design.md:156-157`) — **scope bị
  supersede bởi ADR này**; §10 (`:232`) — chỉ phần D1 bị supersede.
- `agent-harness-plan.md`: Phase 4 — Task 4.1 (`:291`), 4.2 (`:300`), 4.3 (`:309`), 4.4 (`:320`);
  Phase 5 — Task 5.1 (`:334`), 5.2 (`:342`), 5.3 (`:358`); Checkpoint 5 (`:364-366`); Phase 6 —
  6.1 (`:370`), 6.2 (`:373`), 6.3 (`:375`). AD-4 (`:105`), AD-5 (`:108`), AD-6 (`:111`), AD-7 (`:114`).
- `review/idea.md` Clarification 3 (`:37-44`): Q2 (`:40`), Q3 (`:41`), Q5 (`:39`).
- ADR 0010 — remote gateway + PWA, bề mặt mà dispatch từ phone chạy trên đó.
- Commit: `c8dd441`, `4b8512b`, `624fa51`, `878c1f9`, `6058b74`.

## Open items

- **Checkpoint 5** (gate: security-reviewer): packaged golden path dispatch với OpenCode child + LLM
  thật — chọn task → fan-out 2 agent → MỘT permission gate → cả hai kết quả verified → tổng hợp trên
  desktop + phone. Chưa bắt đầu; chặn bởi provider hợp lệ (https endpoint, hoặc ADR nới
  http-on-loopback, hoặc mock LLM deterministic).
- **Task 6.1** negative sweep (`agent-harness-plan.md:370-372`): gateway chết giữa fan-out, token hết
  hạn giữa phiên, phone reply sau khi desktop đã quyết, v.v.
- **Task 6.3** independent security review — bắt buộc, chưa chạy.
- **Áp `permissionPreset` / `skillIds` / `model` per-branch lúc dispatch, hoặc bỏ field** — hiện chỉ
  validate mà không enforce; để nguyên là một field hứa hẹn nhiều hơn thực tế.
- **worktree-per-child** (Task 5.2 option) + rủi ro ghi đè giữa các branch dùng chung workspace.
- **Đo cost/token của fan-out thật**; validate 3/5 với quota provider thật.
- **Persist dispatch run** qua restart (loop `scheduled` hiện chết theo process).
- **D2 cần ADR superseding riêng**: design §7/§10 nói D2 boundary-only, nhưng MS365 connector +
  SharePoint đã có foundation flag-gated (`docs/product/current-status.md:149-215`). Ngoài scope ADR này.
- **AD-7**: `app/ui/src/dispatch-plan.ts` vẫn là business logic ở UI.
