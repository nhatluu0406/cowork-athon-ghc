---
language: "vi"
status: "active"
updated_at: "2026-07-16"
---

# Trạng thái hiện tại

Baseline source được vá từ snapshot `310524c`. Tài liệu canonical: [docs/README.md](../README.md).

## Capability inventory

| Năng lực | Trạng thái | Ghi chú trung thực |
|---|---|---|
| Startup | **BASIC WORKS** | Mở New Chat sạch; lifecycle scripts hiện hữu. |
| Provider profiles | **PARTIAL** | DeepSeek preset + custom OpenAI-compatible profiles; packaged switching giữa hai endpoint thật vẫn cần xác nhận. |
| Credentials | **BASIC WORKS** | Windows keyring theo profile; không persist raw key trong profile JSON. |
| Workspace navigator | **PARTIAL** | Duyệt file và mở preview cơ bản. |
| Workspace editing | **PARTIAL** | `.txt`/`.md` nhỏ có thể sửa; file text bị truncate là read-only; XLSX chuyển read-only để tránh mất dữ liệu. |
| Image / PDF / DOCX preview | **PARTIAL** | Image dùng data URL; PDF dùng blob frame theo CSP; DOCX render plain text. Cần packaged PO check. |
| Chat / streaming | **BASIC WORKS** | OpenCode runtime + conversation persistence. |
| File create / modify bằng Agent | **BLOCKED — PACKAGED CHECK REQUIRED** | Source đã thêm action contract, permission tool mapping và false-success guard; chưa được xác nhận trên packaged Windows app. |
| Permissions | **BLOCKED — PACKAGED CHECK REQUIRED** | Bridge nay ưu tiên `permission.asked.properties.tool`; UI poll nhanh hơn và báo lỗi transport. Golden path create→Allow và modify→Deny phải chạy thật. |
| File Work Review | **PARTIAL** | Create/modify review có nền tảng; delete chưa tin cậy. |
| Attachments | **PARTIAL** | Text attachments bounded; image/PDF attachment vào prompt chưa có. |
| Skills | **BASIC WORKS** | User Skill CRUD + enable/disable; built-in read-only. |
| UI readiness | **PARTIAL / COMMERCIAL FAIL** | Shell dùng được nhưng chưa đạt chuẩn demo thương mại; dark mode thật chưa có. |
| D1–D4 | **NOT IMPLEMENTED** | Chỉ có integration surfaces/mount points; backend teams chưa merge. |
| Full RC | **DEFERRED** | Chưa chạy release-candidate đầy đủ. |

## P0 recovery patch trong source này

- Product action contract bắt buộc model dùng file tool và không được báo thành công khi tool chưa thành công.
- Permission bridge giữ đúng tool thật (`write` → `file_create`) thay vì làm mất thông tin qua permission group.
- File-action response được đánh dấu **chưa xác minh** nếu không có review/disk evidence cùng runtime turn.
- Truncated text và XLSX được chuyển sang read-only để tránh ghi đè phá dữ liệu.
- DOCX không còn chèn HTML chưa sanitize; render plain text.
- Workspace giữ thay đổi chưa lưu khi Agent refresh.

## Exit criterion trước khi tiếp tục UI commercial pass

```text
request create file
→ Permission hiển thị
→ Allow once
→ file tồn tại đúng workspace, đúng nội dung
→ File Work Review có bằng chứng
→ assistant chỉ báo verified success sau mutation
```

---

## Remote gateway + PWA MVP (2026-07-14)

| Item | Status |
|---|---|
| Plan | `agent-harness-plan.md` (repo root) — Phase 2 MVP slice |
| ADR | `docs/architecture/decisions/0010-remote-gateway-and-pwa-surface.md` |
| Feature flag | `CGHC_REMOTE_ENABLED` — **OFF mặc định**; flag off ⇒ composition không đổi (test `remote-wiring.test.ts`) |
| Modules | `service/src/remote-gateway/` — `pairing.ts` (code 1 lần TTL 2 phút, device token SHA-256 digest, lockout, revoke), `gateway.ts` (listener riêng, reverse proxy allowlist tới main service), `pwa.ts` (PWA 1 file: pair → list → live stream) |
| Env phụ | `CGHC_REMOTE_LAN=1` (bind LAN, demo cùng Wi-Fi, **chưa TLS**), `CGHC_REMOTE_PORT` (port cố định) |
| Verified | `npm run typecheck` exit 0; 16/16 unit/integration PASS trên 3 suite mới (`remote-pairing`, `remote-gateway`, `remote-wiring`); suite lân cận `compose-live-wiring` + `live-launch` vẫn PASS |

### Bổ sung cùng ngày: các slice remote hoàn chỉnh MVP

- **Task 1.3 — permission Allow/Deny**: `GET /api/permissions` + `POST /api/permissions/decision`
  (POST allowlist); PWA có khu pending (poll 3s). Verify trên **gate thật**: Deny chặn ở execution
  boundary (`isAllowed=false`, pending rỗng), allow muộn bị từ chối (`already_resolved: deny`).
- **Task 1.2 — send prompt**: `POST /api/sessions/{id}/message` (allowlist single-segment); PWA có
  composer trong detail view; wiring test chứng minh prompt từ phone tới OpenCode child thật.
- **Task 2.4 — `/remote` panel + QR**: router `/v1/remote` (status/pairing-code+QR SVG/revoke/
  revoke-all) dùng chung pairing registry với gateway qua `extraRouters`; lệnh `/remote` trong
  composer mở panel; dep `qrcode` (MIT). QR nhúng URL có `?code=` để PWA tự điền.
- **Task 2.3 — Discord channel**: adapter transport-injectable (notify redacted + `deny` + prompt);
  `approve` ghi tệp **bị từ chối theo Q5**; bot outbound-only, token không log, không gửi nội dung
  tệp. Bật bằng `CGHC_DISCORD_ENABLED` + token/channel/allowlist.
- Tổng: **36/36 test remote PASS** trên 6 suite; typecheck + renderer build sạch. README có mục
  hướng dẫn dùng đầy đủ.

### Giới hạn trung thực

1. Điện thoại xem conversations + transcript + live EV stream, **quyết định permission**, **gửi
   prompt**; Discord notify+deny+prompt. Việc OpenCode child live tiêu thụ lệnh Discord **chưa
   verify end-to-end** với bot thật (unit dùng transport giả).
2. **Pairing code hiển thị qua console** (`start.bat` từ terminal) — chưa có QR/panel trong app.
3. **LAN mode chưa mã hóa transport** — chỉ dùng demo; TLS + cert pinning là slice sau.
4. Device token in-memory per-launch — restart app thì điện thoại pair lại.
5. Chưa có packaged verification cho slice này (dev-run only).

## Dispatch nội bộ: loop runner + fan-out runs + board + slash commands (2026-07-16)

| Item | Status |
|---|---|
| Plan | `agent-harness-plan.md` — Phase 4–5 (Tasks 4.2, 5.2 wiring, 5.3 desktop, 4.4 bổ sung `/dispatch`) |
| Loop runner (Task 4.2) | `service/src/tasks/loop-runner.ts` — `run_once` / `retry_until_verified` / `scheduled`; guardrails maxTurns + maxDurationMs (abort attempt đang chạy), cancel; success có verify chỉ khi hook xác nhận evidence — guardrail stop là `exhausted`, không bao giờ là `completed` giả |
| Dispatch runs (Task 5.2 wiring) | `service/src/dispatchers/` — run-registry (loop trên fan-out group, view secret-free, bounded history) + router token-guarded `/v1/dispatch/*` (run task đã lưu, list/get/cancel run) + live branch runner (mỗi nhánh = một child session thật qua CÙNG session service, prompt seam và MỘT permission gate; Tier 1 dùng not-attached runner trung thực) |
| Dispatch board (Task 5.3 desktop) | Bề mặt Dispatch render catalog task (badge built-in/user, loop mode, hình fan-out) + run views live (status, attempts, verified, branch states) poll 3s chỉ khi đang chạy; badge "Chờ tích hợp D1" giữ nguyên trung thực |
| Slash command | `/dispatch` (list) · `/dispatch run <task-id>` · `/dispatch runs` · `/dispatch cancel <run-id>`; cú pháp sai bị từ chối với hướng dẫn |
| Verified | typecheck service + UI exit 0; renderer build exit 0; 46/46 test service (loop-runner 15, dispatch-run-registry 13, fanout 8, task-store 5, agent-catalog 5) + 26/26 test UI PASS; suite compose-live-wiring / live-launch / remote-wiring vẫn PASS |

### Giới hạn trung thực (dispatch slice)

1. **Chưa có packaged/live verification**: bằng chứng ở mức unit/integration với fake seams;
   chưa chạy fan-out với OpenCode child + LLM thật. (Đây là Checkpoint 5 còn mở — xem handoff.)
2. Branch prompt ghép system prompt của agent vào đầu message (child seam chưa có slot system
   prompt per-session).

## Dispatch backlog hoàn tất (verify hook + 4.3 + 5.3 PWA) — 2026-07-16 (commit `878c1f9`)

Fan-out qua project-harness (Fable 5 orchestrate, workers `.claude/agents/*`). Đã đóng 3 mục
còn thiếu của dispatch:

| Item | Status |
|---|---|
| Verify hook `retry_until_verified` | `service/src/tasks/verify-file-evidence.ts` + nối ở `compose-service.ts` (`createFileEvidenceVerificationHook`). Task chỉ `verified` khi có bằng chứng file/disk thật; không thì `exhausted`, **không bao giờ** `completed` giả. Tier 1 vẫn trung thực khi không kiểm được evidence. |
| Task 4.3 workflow builder từ prompt | `service/src/tasks/workflow-builder.ts` + `workflow-router.ts`. NL prompt → LLM draft TaskDefinition (+ chọn agent, fan-out) → validate bắt buộc qua contract → trả draft review → **confirm riêng mới lưu**. Không đường nào chạy draft chưa confirm; draft schema-injection / nới permission bị từ chối ở boundary (422). Live generator là Tier 2 seam; test dùng fake, không gọi LLM thật. |
| Task 5.3 (PWA/phone) | `service/src/remote-gateway/pwa.ts` tab Dispatch + `gateway.ts` allowlist **chỉ** 5 route (list tasks, list/get runs, 1-touch run, cancel). Task create/update/delete/instantiate từ phone bị chặn 404. Poll 3s chỉ khi có run đang chạy; state trung thực. |
| Verified | typecheck exit 0; **68/68** test dispatch (verify-hook, verify-file-evidence, workflow-builder, remote-dispatch, loop-runner, run-registry, fanout) + **23/23** regression composition/remote PASS. Chưa chạy full suite; chưa packaged/live. |

### Handoff — việc build tiếp theo

- **Checkpoint 5 (task #4, gate: security-reviewer)**: packaged golden path dispatch với
  OpenCode child + LLM thật — chọn task → fan-out 2 agent → MỘT permission gate → cả hai kết
  quả verified → tổng hợp trên desktop + phone. **Chưa bắt đầu.**
- **Chặn Checkpoint 5**: cần provider hợp lệ. Gateway `http://127.0.0.1:8080` của user vẫn bị
  SSRF policy chặn (http-on-loopback) → cần endpoint https **hoặc** quyết định nới policy +
  ADR trước. Đường deterministic: dùng `COWORK_GHC_E2E_MOCK_LLM_BASE_URL` (mock LLM loopback)
  cho verification không cần LLM thật.
- **Chưa làm trong scope dispatch**: full-suite test sweep; đo cost/token của fan-out thật.

## D1 compliance + security review 6.3 — 2026-07-16 (`fe79ff8`, `f3c01b1`, `0da7509`, `7a1cbdc`)

| Item | Status |
|---|---|
| **ADR 0011** (`fe79ff8`) | Đóng gap compliance: design đóng băng L4 (§7:156-157) khóa D1 ở "`DispatchPort` seam shape only", nhưng Phase 4-5 đã ship fan-out chạy thật mà **không** ADR nào ghi lại. ADR 0011 supersede **chỉ dòng D1** (D3/D4 vẫn boundary-only; ADR 0001-0006 không đụng ⇒ L4 giữ `COMPLETED`) — ADR superseding **đầu tiên** của repo. Ghi ánh xạ `DispatchPort` → `BranchRunner` (tên trong design **chưa từng** tồn tại trong code; chốt `BranchRunner` là canonical). |
| **Enforce `permissionPreset`** (`f3c01b1`) | Lỗ thật: preset chỉ được validate, **không** áp lúc dispatch ⇒ built-in `researcher`/`reviewer` khai `edit: "deny"` (và docstring nói "cannot write") vẫn rơi về `edit: "ask"` — user dispatch một reviewer chỉ-đọc vẫn bị hiện prompt xin ghi file và có thể Allow. Nay enforce tại `ToolPermissionProxy.handle`; bind `sessionId → preset` trước `sendPrompt`; bind lỗi ⇒ branch `errored`, prompt **không** gửi. Chỉ đọc `deny` ⇒ chỉ siết, không nới. Tier 1 không đổi. |
| **Audit trung thực** (`f3c01b1`) | Preset-deny **không phải** quyết định của user và không được ghi như vậy: thêm reason `agent_preset` + `PermissionGate.denyByPolicy` (dùng lại validation của `submit` + `finalizeDeny`, **không** tạo `pending`, **không** arm timer). Route user **không forge được**: `ResolutionInput` không có field `reason`. |
| **Security review 6.3** | **ĐÃ CHẠY** (bắt buộc do network exposure) — **không có permission bypass**. Xác nhận không phá được: gateway allowlist (chặn `%2e%2e`/traversal/case/method), phone không CRUD task, main token không rò, Discord không approve (capability-based), workspace boundary + symlink escape ở evidence hook, draft không auto-run, PWA không XSS/CSRF, audit bỏ field free-form. |
| **2 finding đã sửa** (`7a1cbdc`) | (1) **Release preset fail-open**: `finally` release binding khi runner return, trong khi child **có thể còn sống** (`cancelSession` best-effort, nuốt lỗi; terminal `cancelled` là do local tự synthesize) ⇒ preset biến mất ⇒ ask thường ⇒ user/phone Allow ⇒ agent chỉ-đọc ghi file. Đường tới thường: guardrail `maxDurationMs` hoặc cancel từ phone. Nay release **chỉ** khi thấy terminal thật qua poll thường; **giữ** binding ở mọi trường hợp không chắc (giữ = leak trơ bounded; release sớm = fail-open). (2) **Key preset không enforce được**: `{ "*": "deny" }` validate lọt nhưng boundary bỏ qua ⇒ lockdown không tồn tại; nay validator từ chối, mapping canonical ở `core/contracts/src/permission-preset-keys.ts` dùng chung validator + proxy. |
| Verified | `tsc --noEmit` exit 0 (service + core/contracts); **146/146** test service (dispatch + permission + files) + **9/9** contracts PASS. Test retention wire **module thật** (proxy + bindings + runner thật, chỉ fake seam hướng child), encode đúng repro của reviewer cho cả nhánh `cancelSession` thành công lẫn lỗi. |

### Giới hạn trung thực (còn mở sau 6.3)

1. **Chưa packaged/live** — Checkpoint 5 vẫn chưa bắt đầu; phần **release-verifier** của gate 6.3
   chưa chạy (cần packaged artifact).
2. **Không có trần số dispatch run đồng thời / không rate limit** route run từ phone — availability
   + chi phí LLM không chặn trên (`run-registry.ts` chỉ prune run đã kết thúc).
3. **PLAUSIBLE**: gate `states` không evict; `requestId` trùng ⇒ bridge không forward reply ⇒ child
   treo (fail-**closed** trên write, nhưng mâu thuẫn "không bao giờ strand" ở P3). Cần child thật để
   xác nhận ⇒ gắn vào Checkpoint 5.
4. **`retry_until_verified` chỉ chứng minh "file đã khai có tồn tại"**, không phải task thành công —
   ngôn ngữ "không thể fabricate success" mạnh hơn thực tế existence-check mua được.
5. **LAN mode gửi device token plaintext** (`CGHC_REMOTE_LAN=1`, không TLS) — token đó approve được
   lệnh ghi file. Off mặc định và docs thừa nhận là dev/demo flag, nhưng reviewer đề xuất **gate
   cứng** thay vì comment. Thuộc hardening 2.2, ngoài scope D1.

## Hotfix: app tự brick khi settings chứa endpoint http loopback (2026-07-16)

| Item | Status |
|---|---|
| Sự cố | Từ 2026-07-14 17:25, mọi lần mở app packaged đều fail: `settings_only_failed: Outbound target refused by SSRF policy (scheme_not_https): http:` — service (kể cả tier settings-only) không start, renderer kẹt "Không khả dụng", mọi panel trống, không tương tác được |
| Root cause | Profile provider custom với `baseUrl http://127.0.0.1:8080/v1` được LƯU không qua SSRF check, nhưng lúc boot `seedFromSettings` / `syncActiveProfile` re-validate bằng release SSRF policy và THROW — giết toàn bộ service start. App tự brick bằng chính settings đã persist |
| Fix | `compose-service.ts`: hai call site boot-time bắt `SsrfBlockedError` và degrade thành "endpoint chưa cấu hình" (policy vẫn chặn ở runtime; chỉ thu hẹp blast radius). Runtime configure/switch vẫn trả lỗi typed như cũ |
| Regression test | `service/tests/compose-seed-ssrf-resilience.test.ts` — tái hiện đúng document settings gây brick; compose + start + health phải PASS |
| Verified | Test RED→GREEN; typecheck exit 0; chạy Electron shell thật với settings brick thực tế → `settings_only_ready`, `/v1/health` trả 401 khi thiếu token (service sống, token guard đúng) |

### Việc còn mở (quyết định product/security)

1. **Save-path chưa SSRF-validate**: profile store persist `baseUrl` tự do — nên validate lúc
   create/update để từ chối sớm với lỗi typed (không còn brick, nhưng bất đối xứng vẫn còn).
2. **Chính sách http-on-loopback**: user thực tế dùng local gateway `http://127.0.0.1:8080/v1`
   (private-GPT). Release policy hiện cấm http kể cả loopback ⇒ local LLM gateway không dùng
   được trong release build. Cần quyết định product + ADR nếu muốn nới cho loopback tường minh.

## MS365 connector + SharePoint slice — D2 (2026-07-14)

| Item | Status |
|---|---|
| Spec | `docs/superpowers/specs/2026-07-13-ms365-connector-sharepoint-design.md` |
| Plan | `docs/superpowers/plans/2026-07-13-ms365-connector-sharepoint.md` |
| Branch | `feature/ms365-connector-sharepoint` |
| HEAD | `d086ecd` — fix(ms365): advertise tool endpoint to OpenCode child via baseEnv when flag on |
| Feature flag | `CGHC_MS365_ENABLED` — **OFF by default**; with flag off, composition and child env are byte-for-byte unchanged (verified in review) |

### Đã triển khai (what shipped)

- Nền tảng connector MS365 (`ms365-connector`, `ms365-graph-client`, `ms365-errors`) với ánh xạ lỗi Graph rõ ràng.
- Đăng nhập bằng **manual token hoạt động được** (dán access token thủ công, xác thực qua Graph client).
- **Device-code OAuth đã viết code nhưng đang bị chặn (gated)**: chưa có Azure app registration / client ID thật cho tenant thật, nên luồng device-code chưa thể hoàn tất việc kết nối thực sự. Không có trạng thái "đã kết nối" giả nào được hiển thị.
- SharePoint: tìm kiếm (search), liệt kê (list), tóm tắt (summary), và **upload** (ghi, có kiểm soát quyền).
- Tool dispatch cho SharePoint với **upload chỉ chạy sau khi có quyết định Allow được ghi nhận** (permission-gated); Deny chặn thực sự ở boundary thực thi.
- Router loopback token-guarded (`ms365-tool-router` + barrel) làm ranh giới port/adapter cho MS365.
- Khi flag **ON**, service quảng bá (advertise) endpoint tool MS365 cho OpenCode child qua biến môi trường `CGHC_MS365_TOOL_ENDPOINT` / `CGHC_MS365_TOKEN` trong `baseEnv` của child process.

### Bằng chứng hồi quy đã xác minh (verified regression)

```text
npm run typecheck        → exit 0 PASS (trên HEAD d086ecd)
npm run build:renderer   → exit 0 PASS (trên HEAD d086ecd)
MS365 unit tests         → 54/54 PASS, 0 fail, 10 file:
  ms365-errors, ms365-graph-client, ms365-manual-token, ms365-device-code,
  ms365-connector, ms365-sharepoint, ms365-view-redaction, ms365-tool-router,
  ms365-flag-off, ms365-child-env
```

Bộ test đầy đủ của repo có **~20 lỗi có sẵn (pre-existing) trên 13 suite** không liên quan đến
MS365 (`composition-ssot-and-redaction`, `composition-loopback-e2e`, `conversation-relaunch`,
`execution-captured-frames`, `execution-ev-reducer`, `execution-sse-mapper`,
`runtime-session-store-adapter`, `session-live-run-e2e`, `session-restart`,
`session-router-boundary`, `session-stream-hub`, `session-stream-live-e2e`,
`streaming-backpressure`, `streaming-coalesce`). Đây là các suite live/integration/streaming
lỗi trong môi trường dev hiện tại **độc lập** với slice này — không có file nào trong danh sách
là file MS365, và tập lỗi không đổi khi tắt flag MS365. Các suite này KHÔNG được coi là PASS
và KHÔNG do slice này gây ra; báo cáo này không tuyên bố chúng pass.

### Giới hạn trung thực (honesty limitations — phải đọc trước khi coi slice là "xong")

1. **Device-code OAuth bị gate**: chỉ đăng nhập bằng manual token là dùng được thật; device-code
   đã có code nhưng chưa thể hoàn tất kết nối vì chưa có Azure app registration/client ID thật —
   không có trạng thái "đã kết nối" giả.
2. **Quảng bá tool vs. thực sự tiêu thụ (consumption) chưa được xác minh end-to-end**: service đã
   set `CGHC_MS365_TOOL_ENDPOINT` / `CGHC_MS365_TOKEN` trong env của OpenCode child khi flag ON,
   nhưng việc runtime OpenCode thực tế có đọc các biến này để đăng ký MS365 tool thành tool mà
   model có thể gọi (model-callable) **chưa được kiểm chứng qua một child đang chạy thật**. Đây là
   một hạng mục xác minh còn mở (open verification item) — không tuyên bố model đã gọi được
   SharePoint tool trong một phiên chạy thật.
3. **Chưa có xác minh packaged/live với tenant thật**: toàn bộ bằng chứng ở mức unit test; chưa có
   lưu lượng Microsoft Graph / SharePoint thật nào được thực thi.
4. **Thực thi quyền cho hành động ghi (upload)** đã được xác minh ở mức unit (Deny chặn thực sự;
   upload chỉ chạy sau một quyết định Allow được ghi nhận), nhưng **chưa được xác minh qua một
   lượt chạy end-to-end thật**.
5. Slice này **tắt theo mặc định** (`CGHC_MS365_ENABLED=false`); baseline không bị ảnh hưởng khi flag off.

### Kết luận trạng thái

```text
D2 (MS365 connector + SharePoint): foundation implemented behind flag, NOT merge-ready
  as a full live integration. Manual token connect works; device-code gated; tool
  consumption by live OpenCode child not yet verified; no packaged/live tenant run.
```

## Microsoft 365 & Claude Code surfaces (2026-07-13)

| Item | Status |
|---|---|
| Spec | `docs/superpowers/specs/2026-07-13-microsoft-claudecode-surfaces-design.md` |
| Plan | `docs/superpowers/plans/2026-07-13-microsoft-claudecode-surfaces.md` |
| Branch | `feature/ms365-claudecode-surfaces` |
| Microsoft 365 surface | **Complete (honest disconnected shell)** — rail nút `microsoft` mở `section.ms-surface` với segmented "Trợ lý AI" / "Kết nối"; nút đăng nhập `.ms-connect__signin` luôn `disabled`, ghi chú hiển thị rõ "Backend D2 (Microsoft Graph) chưa được tích hợp" |
| Claude Code surface | **Complete (3-column, shared session)** — rail nút `code` mở `section.cc-surface` với `code-explorer` (tree + SOURCE CONTROL thật), `code-editor` (chỉ đọc + diff review), `cc-panel` (dùng chung phiên hội thoại với Cowork); segmented "Phiên làm việc" / "Cách hoạt động" chuyển sang `cc-onboarding` với 4 bước |
| Not included | Không có backend D2 (Microsoft Graph) thật; editor Claude Code không ghi tệp; không có nút accept/reject trên diff (theo đúng spec — chỉ xem lại) |
| Packaged evidence | `reports/ui-shell-v3-commercial-readiness/` — `microsoft-assistant.png`, `microsoft-connect.png`, `code-session.png`, `code-onboarding.png` + `structural-state-check.json` |
| Verification commands | `scripts\build.bat` → `node tools/verify/ui-shell-v3-production-screenshots.mjs` (exit 0) → `scripts\stop.bat` |

Trong lúc bổ sung 4 capture mới, phát hiện một lỗi có sẵn trong assertion của verifier
(`tools/verify/ui-shell-v3-production-screenshots.mjs`): hai điều kiện kiểm tra
"cowork mode phải chỉ hiện view cowork" / "workspace mode phải chỉ hiện view workspace"
thiếu guard `!settingsOpen`, nên khi Settings đang mở thì assertion tự fail sai. Đã sửa
bằng cách thêm `!settingsOpen &&` vào cả hai điều kiện, giữ nguyên các điều kiện lân cận
vốn đã có guard này — không nới lỏng assertion, chỉ sửa đúng lỗi logic khiến kết quả false
negative.

## UI Shell V3 commercial readiness remediation (2026-07-13)

| Item | Status |
|---|---|
| Independent audit branch | `audit/ui-shell-v3-commercial-readiness` |
| Audit commit | `ecce634` — `docs(quality): audit V3 commercial UI readiness` |
| Remediation branch | `fix/ui-shell-v3-commercial-readiness` |
| Audit verdict before fix | **PASS WITH BOUNDED FIXES** — commercial merge blocked by UI-CR-001 through UI-CR-005 |
| Commercial readiness pass | **Code implemented; packaged evidence refresh pending** — Settings is now a full-screen application surface; workspace tree gap, provider untested status color, rail tooltip clipping, and composer alignment are remediated |
| Packaged evidence | `reports/ui-shell-v3-commercial-readiness/` exists, but final refresh after the last Settings/tooltip fixes is still pending packaged GUI smoke |
| Product Owner visual acceptance | **Pending** — do not claim final PASS until PO reviews the commercial-readiness screenshots |
| D1-D4 merge | **Not started** — integration surfaces remain passive slots |
| Multi-Provider Profiles | **Not implemented** |
| File Work Review | **PARTIAL PASS** (unchanged) |
| Full L9 / RC | **Not complete** |

Settings is no longer a backdrop modal. The topbar Settings icon opens a full-screen surface inside the V3 application frame, below the native titlebar/topbar and above the status bar, with internal navigation for **Nhà cung cấp** and **Chung**.

## UI Shell V3 production alignment (2026-07-13)

| Item | Status |
|---|---|
| Design prototype R3 (PO-approved direction) | **Complete** — `d96f205` on `design/ui-shell-v3-prototype` |
| Rejected production port | `794cb00` on `feature/ui-shell-v3-production` — PO rejected visual acceptance because packaged UI still looked like the old shell |
| Alignment branch | `fix/ui-shell-v3-production-alignment` |
| V3 shell in packaged renderer | **Aligned** — V3 frame/component composition replaces the legacy shell composition; `app-shell.ts` remains orchestration/state wiring |
| Major V3 composition | **Approved** — Product Owner accepted the replacement composition after R2 evidence |
| Product chrome / UX completion pass | **Applied** — global Settings restored, native Windows controls retained, provider status semantics clarified, rail/tooltips/composer/discoverability polished |
| Commercial UI Product Owner visual acceptance | **Pending** — awaiting review of `reports/ui-shell-v3-production-r3/` |
| D1–D4 merge | **Not started** — integration surfaces remain `awaiting_integration` |
| Multi-Provider Profiles | **Not implemented** — provider/model control opens existing Settings; no multi-profile dropdown registry |
| File Work Review | **PARTIAL PASS** (unchanged) |
| Full external integration regression | **Deferred** to integration milestone |

Production evidence: `reports/ui-shell-v3-production-r3/` (product chrome/UX screenshots + structural state JSON). R2 remains historical alignment evidence. Regenerate:

```powershell
scripts\build.bat
node tools/verify/ui-shell-v3-production-screenshots.mjs
scripts\stop.bat
```

Design spec: [UI Shell V3 Spec](./ui-shell-v3-spec.md). Prototype reference: `design/ui-shell-v3/`, R3 evidence `reports/ui-shell-v3-r3/`. Prior rejected evidence remains in `reports/ui-shell-v3-production/`.

## Pre-merge stabilization (2026-07-13)

| Item | Status |
|---|---|
| Comprehensive project audit | **Complete** — [audit report](../quality/cowork-ghc-comprehensive-project-audit.md) |
| Commercial UI Product Owner acceptance | **FAIL** — collapsed layout and polish gaps identified before stabilization |
| Pre-merge stabilization | **Applied** — dead verifiers removed, File Review CLI consolidated, shell layout collapse fixes |
| File Work Review | **PARTIAL PASS** — live Journey A–B PASS; Journey C blocked; D–L not completed |
| D1–D4 external integration | **Not merged** — surfaces remain `awaiting_integration` slots only |
| Next milestone | **External integration intake** (D1–D4 merge) — [readiness doc](../integration/external-systems-integration-readiness.md) |
| Architecture refactor (`app-shell.ts`, snapshot/watchdog to service) | **Deferred** until after combined external integration merge |
| Full regression at integration milestone | Planned after D1–D4 code lands |

Baseline commit: `eaeb3eb` — chore(project): stabilize pre-integration baseline

Baseline tag (local, not pushed): `pre-external-integration-2026-07-14`

Canonical intake doc: [External Systems Integration Readiness](../integration/external-systems-integration-readiness.md)

## External integration intake (next milestone)

| Item | Status |
|---|---|
| Baseline commit / tag | **Ready** — `eaeb3eb` / `pre-external-integration-2026-07-14` |
| Next milestone | **External integration intake** (D1–D4) |
| Architecture refactor | **Deferred** until after **combined** external integration merge |
| File Work Review | **PARTIAL PASS** (unchanged) |
| Commercial UI acceptance | **FAIL** (unchanged) |

## Latest Verified Slice

| Field | Value |
|---|---|
| Slice | Integration-Ready UI Shell Foundation |
| Feature commit | `0746112` — feat(ui): establish integration-ready Cowork shell |
| Hardening commits | `fix(files): harden packaged file review capture`; `test(verify): stabilize packaged file review stages`; `fix(files): canonicalize workspace paths in service`; `test(verify): add deterministic file review gateway` |
| Implementation Agent | Cursor |
| Packaged File Review | **PARTIAL PASS** — live Journey A–B PASS; Journey C blocked; D–L not completed in latest run |
| Regression | Latest UI shell foundation: targeted UI tests PASS; `npm run typecheck` PASS; `npm run build:renderer` PASS; `npm run verify:release` PASS. |
| Prior slices still PASS | Skills Foundation A–J; Provider Readiness A–J; Attachment Honesty A–J |

## Latest Verified Slice Commits (prior)

| Commit | Meaning |
|---|---|
| `1604761` | Skills packaged disable/deny recovery strengthened. |
| `97f53bf` | Skills Foundation feature. |
| `4f1e804` | Docs: provider readiness slice record. |
| `3cc4ba6` | Attachment honesty + secret-file safety. |

## Product State

Cowork GHC is a packaged Windows desktop POC (`poc-v0.1`). It is local-first,
workspace-centered, uses OpenCode as the current agent runtime, and supports a
replaceable LLM endpoint. DeepSeek is the current provider used for testing; it is not
a permanent product dependency.

Daily source of truth is Git plus active docs in `docs/product/`, `docs/quality/`,
`docs/architecture/`, and `AGENTS.md`. `.loop-engineer/` is maintenance-only provenance.

## Reference analysis pass

Git/docs reference analysis is complete. Two reference reports were added:

- [CoworkLocalallOS_3 Capability Audit](../references/coworklocalallos3-capability-audit.md)
- [Cowork Frontend Design Assessment](../references/cowork-frontend-design-assessment.md)

D1-D4 have been mapped into the canonical product plan as external parallel tracks:

- D1: Dispatch / fan-out agent.
- D2: Microsoft automation: Teams, SharePoint, OneDrive, Graph.
- D3: Knowledge system: RAG, vector, graph.
- D4: Advanced LLM gateway: key pool, rotation, load balance, failover, cost routing.

Cowork GHC does not currently implement D1-D4. The frontend PDF has been assessed as
design reference only; the active shell direction is now hybrid `1a Airy + 1b rail`:
56px product rail, contextual Cowork sidebar, main chat workspace, and right information
panel. Dispatch, Gateway, Knowledge, Knowledge Graph, and Microsoft 365 are visible
registry-defined integration slots in `awaiting_integration` state only; Code is planned.
They do not show mock provider, task, graph, Microsoft, cost, or RAG data.

## Verified Baseline

- Local service lifecycle, workspace selection, provider/model settings, Windows keyring,
  OpenCode runtime, streaming, permissions, cancellation, provider recovery, and process
  cleanup have packaged POC evidence.
- Conversation persistence, multi-conversation sidebar, search, switch, rename/delete,
  relaunch restore, and linked multi-turn Cowork conversations have packaged/automated evidence.
- Context isolation is verified for new turns: bounded untrusted internal envelopes are not
  persisted or displayed as assistant output.
- Activity timeline, file-change panel, permission history, and bounded text file preview exist.
- **File Work Review**: service-owned bounded snapshot capture, deterministic unified diff,
  persisted review artifacts on conversation activity, attachment vs runtime-read separation,
  secret-like path redaction in review, hash-mismatch banner for stale historical snapshots,
  and activity-panel review surface (no universal Preview tab, no direct editor).
- Attachment Phase 1 plus honesty slice: workspace text files, dispatch preflight fail-fast,
  explicit inclusion metadata, secret-like filename blocking before read, activity wording
  `Đã đưa tệp vào ngữ cảnh`, and no raw attachment content in transcript.
- Provider readiness and Skills Foundation Phase 1 remain as previously verified.

## File Work Review Slice

### What shipped

- **Taxonomy**: `attachment_context`, `runtime_file_read`, `file_created`, `file_modified`,
  `file_deleted`, plus permission history outcomes; Vietnamese past-tense labels for terminal events.
- **Snapshots**: before/after capture at mutation time with SHA-256 hash, size, mtime, truncation flags.
- **Diff**: deterministic line-based unified diff with CRLF/LF normalization; binary metadata-only path.
- **Persistence**: `fileReviews` array on persisted activity snapshot survives relaunch.
- **Secret policy**: reuses `isSecretLikeAttachmentPath`; review shows
  `Nội dung bị ẩn vì file có thể chứa credential hoặc secret.` without raw content.
- **Skills**: file events inherit turn Skill provenance via existing turn metadata; Skills do not bypass permission.
- **UI**: activity right panel review (`Xem lại thay đổi`), copy relative path; open-file deferred.

### Packaged live verification (latest rerun)

```text
File Work Review: PARTIAL PASS
Live Journey A: PASS
Live Journey B: PASS
Journey C: blocked by nondeterministic model/tool selection
Journeys D–L: not completed in the latest run
```

Evidence artifact (best full run): `%TEMP%\cghc-freview-artifacts-ubFNmc`
