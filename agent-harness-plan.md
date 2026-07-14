---
language: "vi"
status: "draft"
updated_at: "2026-07-14"
related: ["AGENT-HARNESS.md", "docs/product/current-status.md", "docs/product/roadmap.md"]
---

# Agent Harness Plan — PWA Remote Control + Built-in Loops / Agents / Tasks

Kế hoạch bổ sung cho [AGENT-HARNESS.md](./AGENT-HARNESS.md): xây một **cổng PWA điều khiển
Cowork app từ điện thoại** (giống dispatch/remote control của Claude Code), kèm theo
**built-in loops, built-in skills, built-in agents với fan-out loop và task definition**.

## 1. Mục tiêu (Goal)

```text
Gõ /remote trong Cowork → chọn channel (lan-qr | tunnel | discord)
→ pair điện thoại (scan QR một lần) hoặc bind Discord
→ xem session đang chạy (streaming) → gửi prompt / tạo task
→ nhận thông báo permission → Allow/Deny thật từ điện thoại hoặc Discord
→ dispatch task cho built-in agents (fan-out N session) → nhận kết quả đã verified.
```

> **Tiến độ (2026-07-14)**: MVP đã chạy — `service/src/remote-gateway/` (pairing + gateway
> allowlist-proxy + PWA), flag `CGHC_REMOTE_ENABLED` OFF mặc định, ADR 0010 accepted, 18/18 test
> PASS, typecheck sạch. Đã phủ: một phần Task 1.1 (read-only API); **Task 1.3 XONG** (permission
> pending + Allow/Deny từ phone, verify trên gate thật: Deny chặn ở boundary, allow muộn bị từ
> chối); một phần 2.1 (chưa keyring/QR), 2.2 (chưa TLS `lan-qr`), 3.1/3.2/3.3 (PWA xem + quyết
> permission, chưa Web Push). Chưa làm: 1.2 (send prompt), 2.3 (Discord), 2.4 (`/remote`), 3.4.

Remote là MỘT feature với **3 channel** (chốt bởi PO 2026-07-14, sau khảo sát GitHub):

| Channel | Kiểu | Tham khảo |
|---|---|---|
| `lan-qr` (primary) | WebSocket over HTTPS trên LAN, pair bằng 1 lần scan QR | TheKinng96/claude-remote |
| `tunnel` (fallback) | Gateway giữ loopback, expose qua Tailscale/VPN của user | buckle42/claude-code-remote; official Remote Control (outbound-only) |
| `discord` | Bot Discord outbound: notification + reply-to-prompt + approve/deny | JessyTsui/Claude-Code-Remote; Omnara `requires_user_input` |

Non-goals (v1): quản lý credential/API key từ điện thoại (KHÔNG bao giờ), đổi workspace từ xa,
full web app song song desktop (ADR 0007 vẫn giữ nguyên tinh thần: đây là **thin control
client**, không phải web application đầy đủ).

## 2. Hiện trạng liên quan (as-is, đã audit 2026-07-14)

Chi tiết trong [AGENT-HARNESS.md](./AGENT-HARNESS.md). Tóm tắt phần dùng được ngay:

| Seam có sẵn | File | Dùng cho |
|---|---|---|
| Token guard per-launch (256-bit, Bearer/`x-cowork-token`, constant-time) | `service/src/server/token.ts` | Mẫu cho device token của PWA |
| Loopback-only bind + Host-header defense | `service/src/server/loopback.ts` | Ranh giới phải mở rộng bằng ADR |
| SSE hạ tầng: stream hub, EV stream router, SSE writer | `service/src/server/session-stream-hub.ts`, `ev-stream-router.ts`, `sse-writer.ts` | PWA subscribe cùng EV stream |
| Permission round trip (OpenCode `permission.asked` → gate → reply) | `service/src/runtime/permission-bridge.ts`, `service/src/files/tool-permission-proxy.ts` | Allow/Deny từ điện thoại đi qua CÙNG một gate |
| Task registry (cancel gate + honest status per session) | `service/src/session/task-registry.ts` | Nền cho TaskDefinition runner |
| Router pattern token-guarded, behind flag (tiền lệ port/adapter) | `service/src/ms365/ms365-tool-router.ts` | Mẫu cho remote-gateway module |
| Dispatch assembly (action contract, budget, skill/attachment context) | `app/ui/src/dispatch-plan.ts` | Phải chuyển xuống service để PWA dùng chung |
| Skills catalog (SKILL.md CRUD, built-in read-only) | `service/src/skills/catalog.ts`, `service/src/extensions/skills-builtin.ts` | Built-in skills đã có nền |
| Permission policy của child (`task: deny`, `bash: deny`) | `service/src/runtime/opencode-config.ts:30` | Fan-out làm ở service, KHÔNG bật subagent trong child |

Khoảng trống phải build: remote transport + pairing, control API có version, TaskDefinition /
AgentDefinition contract, loop runner với guardrails, fan-out orchestrator (D1), PWA client.

## 3. Architecture Decisions (phải chốt trước khi code)

1. **AD-1 — PWA là thin control client, không phải web app.** Static PWA (Vite + TS thuần,
   KHÔNG Next.js) đặt tại `app/remote-pwa/`, được serve bởi chính gateway (same-origin, không
   CORS). Cần ADR mới ghi nhận product-owner kích hoạt scope này, đặt cạnh ADR 0007 (không
   xóa deferral của full web app).
2. **AD-2 — Main service GIỮ loopback-only; remote đi qua MỘT port `RemoteChannel` với 3
   adapter.** Không nới `loopback.ts`. Module mới `service/src/remote-gateway/` sở hữu ranh
   giới, flag `CGHC_REMOTE_ENABLED` OFF mặc định. Ba channel adapter cùng một contract
   (subscribe events, send prompt, permission reply):
   - **`lan-qr` (primary)**: listener WebSocket over HTTPS trên LAN, TLS self-signed với cert
     fingerprint nhúng trong QR pairing (client pin cert ngay lúc pair).
   - **`tunnel` (fallback)**: gateway bind loopback, user expose qua Tailscale/VPN — delta bảo
     mật nhỏ nhất, không cần cert tự quản; cùng PWA client với `lan-qr`.
   - **`discord`**: bot kết nối **outbound** tới Discord gateway (không mở inbound port);
     notification + reply-to-prompt + approve/deny; chỉ gửi summary đã redact, không bao giờ
     gửi nội dung file/diff/secret lên Discord.
3. **AD-3 — Auth per channel, tách khỏi per-launch token.** Per-launch token (`token.ts`) chỉ
   cho desktop UI. Channel PWA (`lan-qr`/`tunnel`): pair bằng QR (mã một lần, TTL ngắn) → đổi
   lấy **device token** bền, lưu Windows keyring (một credential store duy nhất), revoke từng
   thiết bị. Channel `discord`: bot token lưu keyring; chỉ Discord user ID trong allowlist
   được ra lệnh; binding xác nhận một lần bằng mã hiển thị trên desktop. Học từ Anthropic
   Trusted Devices (mục tiêu v2 ghi trong ADR): short-lived scoped credentials + step-up khi
   sign-in quá cũ. Không bao giờ ghi token ra log/QR screenshot lưu đĩa.
4. **AD-4 — Một permission gate duy nhất.** Remote Allow/Deny gọi vào `ToolPermissionProxy`
   hiện có; desktop và phone thấy cùng pending list; quyết định nào đến trước thắng; mọi
   quyết định remote ghi audit event kèm device id.
5. **AD-5 — Fan-out ở tầng service, không bật `task` trong OpenCode child.** Orchestrator tạo
   N session con qua chính runtime supervisor + session store hiện có; giữ `task: deny` để
   permission boundary và visibility không bị model tự ý vượt.
6. **AD-6 — Task/Agent/Loop là data, không phải code.** `TaskDefinition`, `AgentDefinition`,
   `LoopPolicy` là contract trong `core/contracts`, validate ở boundary; built-in read-only +
   user-defined CRUD (giống mô hình Skills hiện tại).
7. **AD-7 — Dispatch assembly chuyển xuống service.** `dispatch-plan.ts` hiện là business logic
   nằm trong UI (vi phạm frontend rule); chuyển thành service module để desktop UI và PWA dùng
   chung một đường dispatch.
8. **AD-8 — Kích hoạt bằng lệnh `/remote`.** Gõ `/remote` trong composer desktop mở remote
   panel — tương tự `claude remote-control`: chọn/bật từng channel (`lan-qr` / `tunnel` /
   `discord`), hiển thị QR khi bật channel PWA, hiện trạng thái kết nối + danh sách thiết bị
   đã pair + Discord binding; `/remote off` tắt và revoke phiên remote đang mở. Lệnh chỉ là
   UI trigger — bật/tắt và enforcement thật nằm ở service (flag + gate), UI không tự quyết.

## 4. Task List

### Phase 0 — Decisions & Contracts (gate: không code remote khi chưa xong)

#### Task 0.1: ADR remote control surface (PWA)
- **Mô tả**: ADR kích hoạt thin control client theo AD-1, ghi rõ scope v1 (monitor + prompt +
  permission reply + task dispatch), non-goals (credential, workspace switch, full web app).
- **Acceptance**: ADR tại `docs/architecture/decisions/` trạng thái accepted bởi PO; ADR 0007
  được cross-reference, không bị mâu thuẫn.
- **Dependencies**: none. **Scope**: S (1–2 file).

#### Task 0.2: ADR remote channels + pairing + threat model
- **Mô tả**: Chốt AD-2/AD-3/AD-8: port `RemoteChannel` với 3 adapter (`lan-qr`, `tunnel`,
  `discord`); pairing QR + device token + revocation; Discord allowlist + binding; threat
  model RIÊNG cho từng channel (token theft, replay, brute force, DNS rebinding, phone mất,
  cert spoofing trên LAN, Discord account bị chiếm, message transit qua server Discord).
  Reference đã khảo sát 2026-07-14: official Remote Control (outbound-only, short-lived scoped
  credentials, Trusted Devices), slopus/happy (E2E qua relay), siteboon/claudecodeui,
  buckle42 (Tailscale+ttyd), TheKinng96 (QR LAN), JessyTsui (Discord/email), Omnara
  (`requires_user_input` → phone).
- **Acceptance**: ADR accepted; mỗi channel có threat model + mitigations map vào test Phase 2;
  ghi rõ Discord là kênh "notify + approve + prompt", không phải kênh xem code.
- **Dependencies**: 0.1. **Scope**: S–M.

#### Task 0.3: Contracts — TaskDefinition / AgentDefinition / LoopPolicy / Remote API v1 DTO
- **Mô tả**: Thêm vào `core/contracts`: `TaskDefinition` (id, name, goal prompt, workspace ref,
  skill refs, agent ref, trigger, stop conditions), `AgentDefinition` (id, name, system prompt,
  skill refs, permission preset, model ref), `LoopPolicy` (mode `run_once |
  retry_until_verified | scheduled`, maxTurns, maxDurationMs, verification hook), DTO cho
  `/api/v1` (session summary, permission pending, task status). Kèm validator.
- **Acceptance**: typecheck PASS; unit test validate schema (hợp lệ + từ chối input xấu);
  không secret nào xuất hiện trong contract.
- **Verification**: `npm run typecheck`; test contract mới PASS.
- **Dependencies**: none (song song 0.1/0.2). **Scope**: M.

### Checkpoint 0
- [ ] Hai ADR accepted, contracts merge sạch, chưa có byte nào của remote listener.

### Phase 1 — Control API v1 (vẫn loopback, chưa có remote)

#### Task 1.1: Read-only control API
- **Mô tả**: Router mới `/api/v1`: list conversations/sessions (metadata không secret), session
  view hiện tại, subscribe EV stream (tái dùng `session-stream-hub` + `ev-stream-router`).
  Đăng ký qua `router-registry.ts`, guard bằng client token hiện có.
- **Acceptance**: gọi bằng script PowerShell trên loopback trả đúng dữ liệu; stream SSE nhận
  cùng EV events desktop UI thấy; response không chứa secret (redaction test).
- **Verification**: unit + integration test router; `npm run typecheck`.
- **Dependencies**: 0.3. **Scope**: M.

#### Task 1.2: Command API — create session, send prompt, cancel
- **Mô tả**: Chuyển dispatch assembly từ `app/ui/src/dispatch-plan.ts` xuống service module
  (`service/src/dispatch/`), giữ nguyên ACTION CONTRACT + budget + skill context; desktop UI
  refactor sang gọi service; thêm endpoint POST prompt / cancel.
- **Acceptance**: desktop UI vẫn hoạt động như cũ (không regression test UI dispatch); prompt
  gửi qua API tạo turn thật; cancel dừng stream qua task-registry.
- **Verification**: test dispatch hiện có (`app/ui/tests/dispatch-plan.test.ts`) chuyển/giữ
  PASS; integration test loopback.
- **Dependencies**: 1.1. **Scope**: L → tách PR riêng cho phần di chuyển dispatch nếu >5 file.

#### Task 1.3: Permission remote round trip
- **Mô tả**: Endpoint GET pending permissions + POST reply (allow_once/deny) đi vào cùng
  `ToolPermissionProxy`; ghi audit event (device/client id, decision, tool, path đã redact).
- **Acceptance**: Deny qua API thực sự chặn tool (test ở execution boundary, không chỉ UI);
  hai client cùng reply → chỉ quyết định đầu tiên có hiệu lực; audit event tồn tại.
- **Verification**: unit test permission decisions (theo testing rules); negative test reply
  trùng/muộn.
- **Dependencies**: 1.1. **Scope**: M.

### Checkpoint 1
- [ ] E2E script trên loopback: list → send prompt → stream → permission asked → Allow qua
      API → file tồn tại trên disk → cancel hoạt động. Typecheck + focused tests PASS.

### Phase 2 — Remote channels: pairing + gateway + Discord (thay đổi bảo mật lớn nhất)

#### Task 2.1: Device pairing + device token store
- **Mô tả**: Pairing flow theo ADR 0.2 cho channel PWA (`lan-qr`/`tunnel`): desktop hiển thị
  QR (one-time code TTL ≤ 2 phút; với `lan-qr` QR nhúng thêm cert fingerprint để client pin)
  → phone POST đổi lấy device token; device registry (id, tên, created, last-seen) lưu
  keyring; revoke per device; rate-limit + lockout cho pairing endpoint.
- **Acceptance**: pair thành công; token revoked bị từ chối ngay; one-time code hết hạn/dùng
  lại bị từ chối; token không xuất hiện trong log (redaction test).
- **Verification**: unit test token lifecycle + negative (expired, revoked, replay, brute
  force); secret-redaction test.
- **Dependencies**: 0.2, 1.3. **Scope**: M.

#### Task 2.2: Remote-gateway listener (`lan-qr` + `tunnel`)
- **Mô tả**: Module `service/src/remote-gateway/` — hai mode cho cùng PWA client:
  `tunnel` (bind loopback, hướng dẫn Tailscale/VPN) và `lan-qr` (listener WebSocket over HTTPS
  trên LAN, TLS self-signed, cert fingerprint phát hành qua QR ở Task 2.1). Cờ
  `CGHC_REMOTE_ENABLED`, OFF mặc định. Main service không đổi một byte khi flag off (theo
  đúng tiền lệ MS365 slice); `loopback.ts` của main service không bị sửa.
- **Acceptance**: flag off ⇒ composition byte-for-byte không đổi (test kiểu `ms365-flag-off`);
  flag on ⇒ chỉ request có device token hợp lệ đi qua; client từ chối cert lạ (pinning test);
  Host-header/DNS-rebinding defense giữ nguyên cho mode tunnel.
- **Verification**: unit + integration; **independent security review bắt buộc** (theo
  CLAUDE.md: runtime/security change).
- **Dependencies**: 2.1. **Scope**: M–L → nếu vượt, tách `tunnel` (M) trước, `lan-qr` (M) sau.

#### Task 2.3: Discord channel adapter
- **Mô tả**: `service/src/remote-gateway/discord/` — bot kết nối **outbound** tới Discord
  gateway; binding qua **private guild** của user (bot được mời vào; Q6 đã chốt): 1 channel
  per workspace, 1 thread per conversation/task; đẩy notification (task terminal
  state, `permission.asked` dạng tóm tắt đã redact); nhận lệnh: reply thường = send prompt,
  `deny <id>` = permission reply qua CÙNG `ToolPermissionProxy`. **V1 KHÔNG cho `approve`
  hành động ghi file từ Discord (Q5 — PO đã chốt)**: gateway từ chối approve-write từ channel
  discord ở service-side; approve phải từ PWA/desktop. Allowlist Discord user ID; bot token
  lưu keyring; KHÔNG BAO GIỜ gửi nội dung file/diff/secret lên Discord — chỉ summary đã
  redact + deep link mở desktop/PWA.
- **Acceptance**: user ngoài allowlist bị từ chối và ghi audit; `deny` từ Discord chặn tool
  thật ở execution boundary; mọi message gửi đi qua redaction test; bot token không xuất hiện
  trong log; bot offline không làm treo session (channel là optional observer).
- **Verification**: unit test command parser + allowlist + redaction; integration với mock
  Discord gateway (default suite không gọi Discord thật).
- **Dependencies**: 1.3, 0.2. **Scope**: M. (Song song được với 2.1–2.2.)

#### Task 2.4: Lệnh `/remote` (activation surface)
- **Mô tả**: Composer command `/remote` mở remote panel: bật/tắt từng channel, hiện QR pairing
  (`lan-qr`/`tunnel`), danh sách device đã pair + revoke, trạng thái Discord binding;
  `/remote off` tắt toàn bộ và revoke phiên đang mở. UI chỉ gọi API của gateway — bật/tắt
  thật và enforcement nằm ở service (AD-8).
- **Acceptance**: `/remote` bật channel → client kết nối được; `/remote off` revoke thật
  (client cũ bị từ chối ngay ở request kế tiếp); trạng thái render trung thực, không fake
  "connected".
- **Dependencies**: 2.1, 2.2 (tab Discord cần 2.3). **Scope**: S–M.

### Checkpoint 2
- [ ] Từ máy thứ hai/điện thoại: bật `/remote` → pair `lan-qr` bằng 1 lần scan QR → gọi được
      API v1; lặp lại qua `tunnel`; Discord nhận notification và `deny` chặn tool thật.
- [ ] `/remote off` revoke mọi channel; mọi negative test PASS.
- [ ] Security review độc lập PASS trước khi merge.

### Phase 3 — PWA client

#### Task 3.1: PWA scaffold
- **Mô tả**: `app/remote-pwa/` — Vite + TS thuần, manifest + service worker (offline shell),
  serve bởi gateway same-origin; màn pairing (nhập/scan mã).
- **Acceptance**: cài được lên màn hình chính Android/iOS; pair thành công; không framework
  ngoài scope (không Next.js); Lighthouse PWA installable PASS.
- **Dependencies**: 2.2. **Scope**: M.

#### Task 3.2: Session list + live stream + send prompt
- **Mô tả**: Danh sách conversation, mở session xem streaming (SSE), gửi prompt mới.
- **Acceptance**: stream hiển thị realtime khớp desktop; prompt từ phone tạo turn thật; mất
  mạng giữa stream → UI báo lỗi + resume được (không fake state).
- **Dependencies**: 3.1, 1.2. **Scope**: M.

#### Task 3.3: Permission Allow/Deny trên phone + notification
- **Mô tả**: Màn pending permission với Allow/Deny thật (Task 1.3). v1 dùng SSE khi app đang
  mở; Web Push (cần HTTPS + push service) tách thành task riêng sau, KHÔNG chặn v1.
- **Acceptance**: Deny từ phone chặn tool thật (verify ở boundary); desktop thấy quyết định
  đồng bộ; UI không render fake "completed".
- **Dependencies**: 3.1, 1.3. **Scope**: S–M.

#### Task 3.4: Trigger task từ phone (Q2 — PO đã chốt scope 1+2)
- **Mô tả**: Màn task trên PWA: list built-in templates + task/schedule đã chạy; **1-touch
  run** (reuse từ Task 4.1); entry "custom bằng prompt" gọi workflow builder (Task 4.3) —
  draft hiển thị trên phone, confirm mới lưu/chạy. KHÔNG có form CRUD đầy đủ trên phone (v1).
- **Acceptance**: 1-touch chạy được template/task cũ từ phone; luồng prompt→draft→confirm
  hoạt động trên phone; không tạo được task bỏ qua validation.
- **Dependencies**: 3.1, 4.1 (custom-by-prompt cần 4.3). **Scope**: M.

### Checkpoint 3 — Golden path mobile
- [ ] Trên điện thoại thật: pair → mở session → gửi prompt → permission asked hiện trên phone
      → Allow → file tồn tại đúng workspace → File Work Review có evidence. (Chính là exit
      criterion hiện tại của product, thêm ngả phone.)

### Phase 4 — Task definitions + Built-in loops

#### Task 4.1: Task store + CRUD router + template reuse
- **Mô tả**: `service/src/tasks/` — persist `TaskDefinition` (JSON, không secret), CRUD +
  validate bằng contract 0.3; built-in task templates read-only; **1-touch reuse** (Q2 đã
  chốt): instantiate task mới từ template hoặc từ task/schedule đã chạy trước đó, chỉ cần một
  thao tác, override tối thiểu (workspace/prompt).
- **Acceptance**: CRUD hoạt động; input xấu bị từ chối ở boundary; relaunch giữ nguyên tasks;
  reuse từ template và từ task cũ ra được task chạy hợp lệ.
- **Dependencies**: 0.3. **Scope**: M. (Song song được với Phase 2–3.)

#### Task 4.2: Loop runner + end-loop guardrails
- **Mô tả**: Runner thực thi TaskDefinition theo `LoopPolicy`: `run_once`;
  `retry_until_verified` (verification hook = file-review evidence / disk check, tái dùng
  false-success guard hiện có); `scheduled` (interval đơn giản). Guardrails: maxTurns,
  maxDuration, cancel qua task-registry, terminal status trung thực (không bao giờ tự báo
  success thiếu evidence).
- **Acceptance**: mỗi mode có test; guardrail dừng đúng; status phản ánh thật kết quả.
- **Dependencies**: 4.1, 1.2. **Scope**: L → tách: runner core (M) + scheduled trigger (S).

#### Task 4.3: Workflow builder từ prompt (Q2 — PO yêu cầu)
- **Mô tả**: User mô tả workflow bằng ngôn ngữ tự nhiên → LLM sinh **draft**
  `TaskDefinition` (+ chọn AgentDefinition phù hợp, kể cả fan-out) → validate bắt buộc qua
  contract 0.3 → hiển thị cho user xem lại và **confirm rồi mới lưu; không bao giờ auto-run**.
  Dùng chung provider port hiện có; draft không hợp lệ schema thì báo lỗi rõ, không lưu.
- **Acceptance**: prompt mô tả → draft đúng schema; draft xấu bị chặn ở boundary; không có
  đường nào chạy task chưa confirm; hoạt động từ cả desktop lẫn PWA.
- **Verification**: unit test generator-output validation (mock LLM); negative test schema
  injection (LLM trả field lạ/permission preset nới rộng → bị từ chối).
- **Dependencies**: 4.1, 5.1 (cần agent catalog để chọn agent). **Scope**: M.

### Phase 5 — Built-in agents + Fan-out (D1)

#### Task 5.1: AgentDefinition catalog
- **Mô tả**: Built-in agents read-only (vd: `researcher`, `implementer`, `reviewer`) + user
  CRUD, mô hình y hệt Skills (catalog + registry); agent = system prompt + skill refs +
  permission preset + model ref.
- **Acceptance**: catalog list/enable; agent áp system prompt vào dispatch thật; permission
  preset không được phép NỚI hơn `LIVE_SESSION_PERMISSION_POLICY` (chỉ được siết).
- **Dependencies**: 0.3, 1.2. **Scope**: M.

#### Task 5.2: Fan-out orchestrator
- **Mô tả**: `service/src/dispatchers/` — nhận 1 TaskDefinition dạng fan-out: tạo N session
  con, mỗi con chạy 1 AgentDefinition, thu kết quả, tổng hợp status; TẤT CẢ đi qua một
  permission gate; `task` trong child vẫn deny; cancel cả nhóm. Concurrency (Q3 đã chốt):
  **mặc định 3, field `maxConcurrency` per TaskDefinition, trần cứng 5 enforce ở service**
  (chưa có D4 key pool nên giữ thấp để tránh HTTP 429).
  Option cách ly ghi trong thiết kế chi tiết: mỗi session con một **git worktree riêng** để
  không giẫm file lẫn nhau (tham khảo official `claude remote-control --spawn worktree`);
  yêu cầu workspace là git repo, fallback same-dir khi không phải.
- **Acceptance**: fan-out 2 agent chạy song song ra 2 kết quả thật; 1 con fail không kéo cả
  nhóm thành fake-success; cancel nhóm dừng mọi con; permission từ mọi con hiện chung pending
  list.
- **Verification**: unit test scheduler/aggregator; integration với mock LLM
  (`provider/e2e-mock-llm.ts`); chi phí bounded (không retry vô hạn — theo testing policy).
- **Dependencies**: 5.1, 4.2. **Scope**: L → tách: scheduler (M) + aggregation/UI wiring (M).

#### Task 5.3: Dispatch board (desktop + PWA)
- **Mô tả**: Bảng task/fan-out: trạng thái từng agent con, kết quả, evidence link; slot D1
  `awaiting_integration` hiện có trong shell chuyển thành surface thật.
- **Acceptance**: trạng thái render trung thực theo EV events; PWA xem + trigger được task.
- **Dependencies**: 5.2, 3.2. **Scope**: M.

### Checkpoint 5 — Golden path dispatch
- [ ] Từ phone: chọn built-in task → fan-out 2 built-in agents → theo dõi tiến độ → Allow
      permission → cả hai kết quả verified → tổng hợp hiển thị trên phone và desktop.

### Phase 6 — Hardening & Acceptance

- **Task 6.1**: Negative test sweep theo `testing.md`: mất mạng giữa stream, token hết hạn
  giữa phiên, phone reply sau khi desktop đã quyết, gateway chết giữa fan-out, clean.bat không
  đụng device registry, v.v. (**Scope**: M)
- **Task 6.2**: Packaged verification: `scripts\build.bat` → chạy golden path mobile + dispatch
  trên bản packaged → cập nhật `docs/product/current-status.md`. (**Scope**: S–M)
- **Task 6.3**: Independent review lần cuối (security + release-verifier) — bắt buộc vì đây là
  thay đổi network exposure + process lifecycle. (**Scope**: S)

## 5. Thứ tự & song song hóa

```text
0.1 ─ 0.2 ──────────────┐
0.3 ────────┬───────────┤
            │           │
1.1 → 1.2 → 1.3         │        (loopback only)
            │           │
      2.1 → 2.2 ─┬→ 2.4 ← ──────┘  (security review gate)
      2.3 ───────┘               (Discord — song song 2.1–2.2, sau 1.3)
            │
3.1 → 3.2 → 3.3 → 3.4            (PWA — sau 2.2; 3.4 cần 4.1, custom-by-prompt cần 4.3)
4.1 → 4.2 → 4.3 (song song Phase 2–3, không phụ thuộc remote; 4.3 cần thêm 5.1)
5.1 → 5.2 → 5.3 (sau 4.2 + 1.2)
6.x cuối cùng
```

Song song an toàn: Phase 4 (tasks/loops) với Phase 2–3 (remote); Discord adapter (2.3) với
pairing/gateway (2.1–2.2); contracts (0.3) với ADR (0.1/0.2). Bắt buộc tuần tự: 2.1 → 2.2
(pairing trước listener), 2.4 sau khi có ít nhất một channel, 5.2 sau 4.2, 4.3 sau 5.1
(cần agent catalog), 3.4 sau 4.1.

## 6. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| ADR 0003/0007 xung đột với remote/PWA | High | Phase 0 là gate cứng; không code remote trước khi ADR accepted |
| Golden path permission packaged đang `BLOCKED` | High | Checkpoint 1 chạy lại golden path loopback trước; remote permission xây trên nền đã pass |
| Network exposure = rủi ro bảo mật lớn nhất của product | High | Flag OFF mặc định, outbound-only/tunnel ưu tiên, device token + revoke, cert pinning cho `lan-qr`, independent security review bắt buộc (Task 2.2, 6.3) |
| Discord transit qua server bên thứ ba (không E2E) | Medium | Channel `discord` chỉ gửi summary đã redact + permission prompt + deep link; không bao giờ gửi nội dung file/diff/secret; allowlist user ID; audit mọi lệnh |
| Chiếm được Discord account = chiếm được quyền điều khiển | High | Allowlist + binding code một lần trên desktop; **đã chốt Q5**: Discord chỉ notify + `deny` + send prompt, approve hành động ghi file bắt buộc từ PWA/desktop (enforce ở service) |
| ~20 test fail có sẵn trên 13 suite dev env | Medium | Không tính các suite đó vào acceptance; test mới phải độc lập và tự PASS |
| Fan-out đốt quota endpoint (chưa có D4 gateway) | Medium | Bounded concurrency ≤ 3, maxTurns/budget trong LoopPolicy, mock LLM cho test |
| Web Push cần HTTPS/push service | Low | Đẩy ra khỏi v1; SSE khi app mở là đủ cho golden path |
| Di chuyển dispatch UI→service gây regression desktop | Medium | Task 1.2 giữ nguyên test hiện có, refactor có test bao trước |

## 7. Open Questions (cần Product Owner)

1. ~~Transport v1~~ — **ĐÃ CHỐT 2026-07-14**: 3 channel trong một feature remote, bật bằng
   `/remote`: `lan-qr` (WebSocket HTTPS + QR một lần) primary, `tunnel` (Tailscale) fallback,
   `discord` (bot notification + reply + approve/deny).
2. ~~Scope remote v1~~ — **ĐÃ CHỐT (PO 2026-07-14)**: monitor + prompt + permission **VÀ**
   trigger task có sẵn từ phone; template/schedule cũ **1-touch reuse**; custom bằng prompt
   mô tả workflow để tự build agents workflow & task (→ Task 3.4 + 4.3). KHÔNG có form CRUD
   đầy đủ trên phone trong v1.
3. ~~Fan-out limit~~ — **ĐÃ CHỐT (PO 2026-07-14)**: mặc định 3, `maxConcurrency` config per
   task, trần cứng 5 ở service (→ Task 5.2).
4. ~~Web Push v1~~ — **ĐÃ CHỐT (PO 2026-07-14)**: KHÔNG cần v1. PWA dùng SSE/WebSocket khi
   app mở; notification khi rời app do channel Discord đảm nhiệm. Web Push dời v2.
5. ~~Discord có được phép `approve` hành động GHI file không?~~ — **ĐÃ CHỐT (PO approved
   2026-07-14)**: v1 Discord chỉ notify + `deny` + send prompt; `approve` hành động ghi file
   bắt buộc từ PWA/desktop. Enforce ở service (gateway từ chối approve-write từ channel
   discord), không chỉ ẩn nút.
6. ~~Discord bind~~ — **ĐÃ CHỐT (PO 2026-07-14)**: private guild + thread — bot được mời vào
   guild riêng của user; 1 channel per workspace, 1 thread per conversation/task (→ Task 2.3).

> Tất cả open questions của vòng 1 đã được PO chốt (2026-07-14). Phase 0 (ADR + contracts)
> không còn bị chặn bởi quyết định sản phẩm nào.
