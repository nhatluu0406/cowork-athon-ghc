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
slot system prompt per-session ở child seam; áp `skillIds` / `model` của agent tại thời điểm dispatch
(`permissionPreset` **đã** được áp — xem §3); persist dispatch run qua restart; D4 key pool.

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
- **Permission preset narrowing-only**: `isNarrowingPreset` (`core/contracts/src/dispatch.ts`)
  từ chối bất kỳ preset nào **nới** so với base; `validateAgentDefinition` enforce. Từ `7a1cbdc`,
  validator còn **từ chối key không enforce được**: `isNarrowingPreset` nhận *mọi* key (key lạ có
  base rank mặc định `ask` nên `deny` luôn "narrow" và lọt), trong khi boundary chỉ tra `edit`/`bash`
  ⇒ `{ "*": "deny" }` từng được nhận, lưu, hiển thị mà **không bao giờ** được enforce — một lockdown
  không tồn tại. Nay mapping canonical nằm ở `core/contracts/src/permission-preset-keys.ts`, và
  `ENFORCEABLE_PRESET_KEYS` được **derive** từ chính nó (check `never` giữ danh sách action kind
  khớp union), cả validator lẫn proxy đọc **cùng một nguồn** nên không thể drift.
  Base là `LIVE_SESSION_PERMISSION_POLICY` (`service/src/runtime/opencode-config.ts:30-46`), áp cho
  built-in lúc boot (`service/src/agents/catalog.ts:78-81`), cho user agent (`:98`, `:120-125`), và
  cho agent do LLM đề xuất trong workflow draft (`service/src/composition/compose-service.ts:305`).
  **Preset được áp per-branch tại execution boundary** (commit `f3c01b1`, đóng Open item của chính
  ADR này — bản ADR đầu ghi nhận preset lúc đó *chỉ* được validate mà chưa enforce): `BranchPlan`
  mang `preset` của agent (`service/src/dispatchers/fanout.ts`), live branch runner **bind**
  `sessionId → preset` sau `createSession` và **trước** `sendPrompt`; bind lỗi ⇒ branch `errored`
  và prompt **không bao giờ** được gửi (fail closed). Điểm enforce là
  `ToolPermissionProxy.handle` (`service/src/files/tool-permission-proxy.ts`) — nơi duy nhất mọi
  tool-permission event đã đi qua trước khi tới gate: preset `deny` ⇒ auto-deny **trước** cả bước
  resolve path, **user không bao giờ bị hỏi** điều mà chính preset của agent cấm. Chỉ giá trị `deny`
  được đọc từ preset ⇒ chỉ có thể **siết**, không bao giờ **nới**. Hệ quả: built-in `researcher` /
  `reviewer` khai `{ edit: "deny" }` (`service/src/agents/builtins.ts:20,40`) nay thật sự không ghi
  được file. Tier 1 (không có child) không đổi: không có branch session thì không có gì để enforce —
  và nó không giả vờ enforce.
- **Release binding là BẤT ĐỐI XỨNG với bind — cố ý** (commit `7a1cbdc`, sau security review 6.3).
  Bản đầu release trong `finally` gắn với "runner đã return" chứ không phải bằng chứng child đã
  chết ⇒ **fail-open**: `cancelSession` là best-effort, nuốt lỗi, và kể cả thành công vẫn còn cửa sổ
  trước khi child thật dừng (terminal `cancelled` ở view local do `session/task-registry.ts` tự
  synthesize, độc lập với child; `permissionBridge.handleFrame` vẫn forward frame thật). Sau release,
  preset biến mất ⇒ request thành ask thường ⇒ user **hoặc phone** Allow được ⇒ agent chỉ-đọc ghi
  file. Đường tới rất thường: guardrail `maxDurationMs`, hoặc cancel từ phone. Nay: release **chỉ** ở
  một điểm — terminal thật quan sát qua poll **thường** (chưa từng đi qua nhánh abort). **Giữ**
  binding khi: abort/cancel (dù `cancelSession` thành công hay lỗi), `sendPrompt` lỗi (POST có thể
  đã tới child), session "biến mất" (`terminal() === undefined` là *không biết*, không phải *xác
  nhận đã chết*), và mọi exception bất ngờ (**không** còn `finally` bao trùm — "không release" là
  **mặc định**, không phải một allow-list các ngoại lệ được cho là an toàn). Lý do: binding còn sót
  là leak trơ, bounded (session coi như đã chết, OpenCode luôn cấp session id **mới** cho branch
  mới) — còn release sớm là fail-open. Thiết kế "poll rồi release khi timeout" đã bị loại vì là
  theater: `cancelSession()` set terminal local ngay lập tức nên poll sẽ "xác nhận" giả gần như tức
  thì. **Chưa seam nào báo cái chết thật của child** — ghi rõ ở module doc thay vì ngụ ý có.
- **Audit ghi đúng ai từ chối**: preset-deny **không phải** quyết định của user và không được ghi như
  vậy. `PermissionDecisionReason` có thêm `"agent_preset"` (`service/src/permission/ports.ts`), và
  gate có method hẹp `denyByPolicy` (`service/src/permission/permission-gate.ts`) dùng lại đúng
  validation của `submit` (id không rỗng, từ chối trùng `requestId`) và `finalizeDeny` (audit,
  session terminal, forward deny reply — P3/P5), nhưng **không** tạo trạng thái `pending` và
  **không** arm fail-closed timer (không có ai để chờ trả lời). Route user **không thể forge** reason:
  `ResolutionInput` không có field `reason`, nên `resolve()` luôn quy deny của nó về `user_decision`
  (có test khẳng định).
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
- (+) `permissionPreset` của agent **được enforce per-branch** ở execution boundary (Decision §3,
  commit `f3c01b1`); preset-deny mang audit reason riêng `agent_preset`, không mạo danh user.
- (−) `skillIds` / `model` của agent **vẫn chưa được áp per-branch** — hai field này hiện hứa nhiều
  hơn thực tế; xem Open items.
- (−) `ms365_write` **không** đi qua `ToolPermissionProxy` (`service/src/ms365/ms365-tools.ts` submit
  thẳng tới gate), nên preset của branch **không** chi phối MS365 write. MS365 flag-gated off mặc
  định và ngoài scope dispatch; ghi ở Open items để không ai đọc nhầm là đã có.
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
- (~) **Task 6.3 security review đã chạy** (2026-07-16): không có permission bypass; hai finding đã
  sửa ở `7a1cbdc`; phần còn mở đã ghi ở Open items. Phần **release-verifier** của gate vẫn **chưa**
  chạy (cần packaged artifact — gắn với Checkpoint 5). ADR này **không** thay thế review đó.

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
- ~~**Task 6.3** independent security review~~ — **ĐÃ CHẠY** 2026-07-16 trên `0da7509`. Kết luận:
  **không có permission bypass** — không đường nào mutate filesystem mà không có Allow được ghi
  nhận. Reviewer truy code và **xác nhận** (không phá được): `denyByPolicy` không forge được từ route
  user; gateway allowlist chặn `%2e%2e`/traversal/case/method confusion; phone không CRUD task được
  và không nhét được `TaskDefinition` inline; main client token không bao giờ tới remote client;
  Discord không approve được (capability-based — không có hook `approve` để với tới, **mạnh hơn** mô
  tả "bị từ chối trong adapter" ở trên); workspace boundary chặn traversal/symlink escape kể cả ở
  evidence hook (`captureWorkspaceFileSnapshot` trả `exists: false` khi escape ⇒ **không** fabricate
  được `verified: true`); draft không auto-run và `__proto__` bị `rejectUnknownShape` chặn; PWA không
  XSS (`textContent`), không CSRF (token ở `sessionStorage` + header, không cookie); audit bỏ đúng
  field free-form; `task: "deny"` giữ trong child policy. **Hai finding đã sửa** (`7a1cbdc`): release
  fail-open lúc abort, và key preset không enforce được. **Còn mở** — xem ba mục dưới.
- **Không có trần số dispatch run đồng thời, không rate limit trên route run từ phone**
  (`service/src/dispatchers/run-registry.ts` — `prune()` chỉ evict run **đã kết thúc**). Có trần
  per-run (5 branch, concurrency 5) nhưng **không** trần số run. Một phone đã pair POST
  `/api/dispatch/tasks/{id}/run` liên tục ⇒ số child session và chi phí LLM không chặn trên; loop
  `scheduled` sống tới `maxDurationMs` nên run không finish và không bị prune. Availability/cost,
  không phải bypass.
- **PLAUSIBLE — gate `states` map không bao giờ evict; `requestId` trùng làm child treo**
  (`service/src/permission/permission-gate.ts`). Mọi `requestId` bị giữ suốt đời process;
  `assertNewRequest` throw khi trùng; `permission-bridge` bắt lỗi, log, **không** forward reply ⇒
  OpenCode chờ mãi và P6 timer chưa từng được arm. Fail-**closed** trên write (không Allow nào được
  forward) nên là availability, nhưng mâu thuẫn với câu "runtime không bao giờ bị strand" ở docstring
  P3. Phụ thuộc scheme id của OpenCode — chính `permission-bridge` cũng ghi ngờ id có thể chỉ
  scoped theo session; nếu vậy fan-out (5 branch cùng đổ vào một keyspace global) làm va chạm **dễ**
  hơn nhiều. Cần child thật để xác nhận ⇒ gắn vào Checkpoint 5. Pre-existing (CGHC-016/018), bị
  slice này khuếch đại.
- **`retry_until_verified` chứng minh "file đã khai có tồn tại", không phải "task thành công"**
  (`service/src/tasks/verify-file-evidence.ts` chỉ kiểm `snapshot.exists`). Path đến từ EV
  `file_mutation` thật nên phần đó trung thực, nhưng một agent ghi một file vặt cũng thỏa hook. Câu
  "không thể fabricate success" ở §3 **mạnh hơn** những gì existence-check mua được — không khai
  thác được nếu không có Allow của người, nhưng ngôn ngữ cần đúng mức.
- **LAN mode gửi device token plaintext** (`CGHC_REMOTE_LAN=1` bind `0.0.0.0`, không TLS) — token đó
  với tới `/api/permissions/decision` ⇒ **approve được lệnh ghi file**; ai trong Wi-Fi sniff được là
  ghi được. ADR 0010 đã ghi đây là dev/demo flag, off mặc định, TLS là slice sau — reviewer đề xuất
  **gate cứng** (từ chối LAN mode ngoài dev build) thay vì chỉ một comment. Liên quan: bảo đảm
  "Discord không approve được" (Q5) **quy hết** về ranh giới pairing, mà trong LAN mode ranh giới đó
  là một token plaintext — hai quyết định này tương tác mà **chưa ADR nào bàn** (thuộc 2.2, ngoài
  scope D1).
- ~~**Áp `permissionPreset` per-branch lúc dispatch**~~ — **ĐÃ ĐÓNG** bởi commit `f3c01b1`
  (xem Decision §3). Còn lại: **áp `skillIds` / `model` per-branch, hoặc bỏ field** — hai field này
  vẫn chỉ được validate mà không enforce lúc dispatch.
- **`ms365_write` không chịu preset của branch** (submit thẳng tới gate, không qua
  `ToolPermissionProxy`). Chỉ thành vấn đề thật nếu MS365 được bật cùng dispatch; cần quyết định khi
  viết ADR cho D2.
- **worktree-per-child** (Task 5.2 option) + rủi ro ghi đè giữa các branch dùng chung workspace.
- **Đo cost/token của fan-out thật**; validate 3/5 với quota provider thật.
- **Persist dispatch run** qua restart (loop `scheduled` hiện chết theo process).
- **D2 cần ADR superseding riêng**: design §7/§10 nói D2 boundary-only, nhưng MS365 connector +
  SharePoint đã có foundation flag-gated (`docs/product/current-status.md:149-215`). Ngoài scope ADR này.
- **AD-7**: `app/ui/src/dispatch-plan.ts` vẫn là business logic ở UI.
