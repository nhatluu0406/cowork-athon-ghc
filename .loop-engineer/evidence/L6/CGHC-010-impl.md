---
task: "CGHC-010"
loop: "L6"
capability: "provider-port"
requirement: "PR1"
vertical_slice: "VS-04"
owner: "runtime-llm-engineer"
reviewer: "security-reviewer"
language: "vi"
adr: ["0005", "0001", "0006", "0008"]
status: "IMPLEMENTED_PENDING_REVIEW"
live_tested: false
---

# CGHC-010 — ProviderPort + chính sách SSRF (bằng chứng triển khai)

Nhiệm vụ: xây `ProviderPort` provider-neutral, screen-independent (một implementation ủy
quyền wire call cho OpenCode runtime), hỗ trợ 5 target (Anthropic, OpenAI, Google,
OpenRouter, và một endpoint OpenAI-compatible do người dùng tự định nghĩa — PR10), cùng
chính sách **SSRF** cưỡng chế tại **service** (không phải UI) và guardrail cho test-mode
escape. Đây là task nhạy cảm về bảo mật (R3 SSRF qua custom endpoint).

Không có live LLM/provider call và không có key thật ở bất kỳ đâu. Mọi provider được đánh
dấu `liveTested: false` (PR10).

## Các file đã tạo (chỉ trong `service/src/provider/` + `service/tests/provider-*.test.ts` + evidence)

- `service/src/provider/ip-classify.ts` — phân loại IP đã-resolve thành
  `loopback | cloud_metadata | link_local | private | public` (IPv4, IPv6, IPv4-mapped).
- `service/src/provider/ssrf-policy.ts` — chính sách SSRF outbound với **resolver được
  inject** (seam DNS); `evaluate`/`assertAllowed`; re-resolve tại connect.
- `service/src/provider/test-mode.ts` — guardrail escape: hằng số build-time `BUILD_PROFILE`,
  cờ launch tường minh, hard-assert refuse-to-start trong release, WARN + audit khi active.
- `service/src/provider/descriptors.ts` — 5 descriptor target (PR10), lấy env-var name từ
  `BUILTIN_PROVIDER_ENV` của CGHC-001; map descriptor → `ProviderEnvSpec`.
- `service/src/provider/error-map.ts` — taxonomy lỗi PR7 (status → kind), CGHC-020 tinh chỉnh.
- `service/src/provider/provider-port.ts` — interface `ProviderPort` + implementation ủy quyền
  runtime qua seam `ProviderConnector`; `guardedConnect` gắn DNS-rebinding guard.
- `service/src/provider/router.ts` — boundary router token-guarded (không `publicUnauthenticated`);
  cờ test-mode **không** phải field của request body.
- `service/src/provider/index.ts` — barrel local (không sửa `service/src/index.ts`).
- Tests: `service/tests/provider-configuration.test.ts`, `provider-ssrf.test.ts`,
  `provider-router.test.ts`.

## Acceptance → nơi thỏa mãn (mapping)

1. **ProviderPort provider-neutral, screen-independent, một impl ủy quyền OpenCode; 5 target;
   credential tham chiếu không nhúng.**
   - Interface + factory: `provider-port.ts` (`ProviderPort`, `createProviderPort`). Runtime wire
     call được ủy quyền qua seam `ProviderConnector` (`probe`/`cancel`); CGHC-011/012 cấp impl
     thật — port không tự dựng HTTP (tuân "no duplicate provider logic", ADR 0005).
   - 5 target dạng **dữ liệu** ở `descriptors.ts` (`PROVIDER_DESCRIPTORS`): anthropic, openai,
     google, openrouter, `custom-openai-compat`. Thêm provider = thêm descriptor, không thêm nhánh.
   - Provider-neutral được test: không method nào của port mang tên vendor
     (`provider-configuration.test.ts` → "public surface is provider-neutral").
   - Credential **tham chiếu**: `configureCredential(id, ref)` chỉ lưu `CredentialRef` handle; test
     chứng minh không có byte key trong state (`configureCredential stores a HANDLE only`).
   - Env-var name lấy từ `BUILTIN_PROVIDER_ENV` (CGHC-001), không tái khai báo.

2. **SSRF cưỡng chế tại service:** `ssrf-policy.ts` + gọi trong `provider-port.ts`
   (`configureEndpoint` tại config-time và `guardedConnect` tại connect-time). Router chỉ chuyển
   tiếp; UI/renderer không quyết định chính sách.
   - Require `https`: scheme khác https bị chặn (`scheme_not_https`); `http` chỉ được phép trên
     loopback dưới escape.
   - Chặn RFC-1918 (10/8, 172.16/12, 192.168/16), link-local (169.254/16 + fe80::/10), loopback
     (127/8, ::1, IPv4-mapped), cloud-metadata (169.254.169.254, fd00:ec2::254).
   - **Validate IP đã-resolve tại connect (DNS-rebinding guard):** hostname được **re-resolve**
     mỗi lần connect qua resolver được inject; nếu **bất kỳ** địa chỉ nào bị cấm thì từ chối.

3. **Guardrail cho test-mode escape:** `test-mode.ts`.
   - Build-time constant `BUILD_PROFILE` (= `"release"`) + cờ launch tường minh; chỉ active khi
     `buildProfile !== "release" && launchFlag`.
   - Dead-code-elimination: nhánh escape nằm sau `BUILD_PROFILE !== "release"` (bundler fold về
     `false` trong release). Hard-assert: `resolveLoopbackEscape` **throw** `ReleaseGuardrailError`
     (refuse-to-start) nếu release mà cờ bật.
   - Chỉ nới **loopback tường minh**; link-local/metadata/RFC-1918 vẫn chặn kể cả test-mode.
   - WARN banner + local audit event khi active.
   - Unreachable từ renderer: cờ là input launch-config, **không** phải field request body; router
     bỏ qua `loopbackEscape`/`buildProfile` nếu bị nhét vào body.
   - Release negative test chứng minh không thể nới prod policy (xem dưới).

## Các vector SSRF bị chặn (đều có test trong `provider-ssrf.test.ts`)

| Vector | Ví dụ base_url | reason |
|---|---|---|
| cloud-metadata | `https://169.254.169.254/...` | `cloud_metadata` |
| RFC-1918 10/8 | `https://10.0.0.5/v1` | `private` |
| RFC-1918 172.16/12 | `https://172.16.0.9/v1` | `private` |
| RFC-1918 192.168/16 | `https://192.168.1.1/v1` | `private` |
| loopback 127/8 | `https://127.0.0.1/v1` | `loopback` |
| link-local 169.254/16 | `https://169.254.10.20/v1` | `link_local` |
| IPv6 ::1 / fe80:: / ::ffff:127.0.0.1 | `https://[::1]/v1` … | `loopback`/`link_local` |
| hostname → private IP | `https://evil.example` → 10.0.0.7 | `private` (validate IP đã-resolve, không tin hostname) |
| hostname → metadata | `https://sneaky.example` → 169.254.169.254 | `cloud_metadata` |
| non-https | `http://api.example.com/v1` | `scheme_not_https` |

**DNS-rebinding guard:** test "a host that flips public→private after config is caught at
connect": resolver trả public ở config-time (pass) nhưng private ở connect-time; `guardedConnect`
**re-resolve** → từ chối và **callback connect không chạy** (`connectRan === false`, resolver được
gọi ≥ 2 lần). Đây là điểm mấu chốt: không tin hostname đã validate trước đó, re-check IP mỗi connect.

**Release-mode-can't-relax proof** (`provider-ssrf.test.ts`):
- `resolveLoopbackEscape({ buildProfile: "release", launchFlag: true })` → **throw**
  `ReleaseGuardrailError` (refuse-to-start).
- `productionLoopbackEscape(true)` → throw (vì `BUILD_PROFILE === "release"`); `(false)` → `false`.
- Với escape = false (kết quả của release), policy **vẫn chặn loopback** dù caller muốn nới.
- Router: body nhét `loopbackEscape:true` bị **bỏ qua**, `https://localhost.evil` (→127.0.0.1) vẫn
  bị từ chối với `SSRF policy: loopback` (`provider-router.test.ts`).
- Test-mode (development) chỉ nới loopback; `10.0.0.9` và `169.254.169.254` vẫn bị chặn.

## Lệnh test + kết quả PASS thật

Provider (`service/`):
```
node --import tsx --test "tests/provider-*.test.ts"
ℹ tests 32   ℹ pass 32   ℹ fail 0
```

Toàn bộ suite (`service/`):
```
node --import tsx --test "tests/**/*.test.ts"
ℹ tests 115   ℹ pass 115   ℹ fail 0
```

Typecheck:
```
npx tsc -b service/tsconfig.json
TypeScript: No errors found  (exit 0)
```

## Giả định (assumptions)

- Wire streaming/probe được ủy quyền cho OpenCode runtime qua seam `ProviderConnector`; CGHC-011/012
  cấp impl thật. Task này **không** dựng streamChat để tránh trùng contract EV/SSE (CGHC-012 sở hữu).
- `mapProviderError` là mapping PR7 tối thiểu theo bảng ADR; CGHC-020 tinh chỉnh theo body từng
  provider và tune retry bound.
- `redactionPatterns()` chỉ là gợi ý phát hiện; cơ chế redaction thật là value-based scrubber của
  CGHC-021.
- Danh sách model trong descriptor là preset tối thiểu; catalog đầy đủ do runtime/models.dev cấp sau.
- DCE của nhánh escape phụ thuộc bundler đọc `BUILD_PROFILE` là literal; hard-assert là backstop nếu
  DCE không chạy.

## Security review — findings & xử lý

- **F1 (MEDIUM, ĐÃ FIX):** trước đây IPv6 chỉ xử lý `::ffff:` mapped → các dạng embed IPv4 khác
  fail-open (classify `public`). Đã viết lại `ip-classify.ts` fail-safe: expand IPv6 đầy đủ, decode
  mọi dạng embed (IPv4-mapped `::ffff:a.b.c.d`, translated `::ffff:0:a.b.c.d`, compat `::a.b.c.d`/`::x`,
  NAT64 `64:ff9b::/96`) và re-classify qua IPv4 classifier; backstop chặn low-32 bits rơi vào dải
  hostile (trừ 0.0.0.0/8 để tránh false-positive với global-unicast kết thúc `::x`). Vector đã chặn
  (qua `classifyIpv6` + `evaluate()`, IP literal nên resolver KHÔNG được gọi):
  - `::a9fe:a9fe` (compat 169.254.169.254) → `cloud_metadata` → REFUSED
  - `64:ff9b::a9fe:a9fe` (NAT64 metadata) → `cloud_metadata` → REFUSED
  - `::ffff:0:a9fe:a9fe` (translated metadata) → `cloud_metadata` → REFUSED
  - `::a01:203` (compat 10.1.2.3) → `private` → REFUSED
  - control `::ffff:169.254.169.254` → `cloud_metadata` REFUSED; `::ffff:127.0.0.1` → `loopback` REFUSED
  - non-regression: `2606:4700:4700::1111` (public) → vẫn `public` ALLOWED.
  Có unit vector cho từng chuỗi trong `provider-ssrf.test.ts` (block F1).

- **F2 (HIGH — GATE cho CGHC-011/012, KHÔNG implement socket ở task này):** `guardedConnect` trả
  `ConnectTarget{ url, resolved }` nhưng không ép connector connect tới `resolved`. Nếu CGHC-011/012 làm
  `fetch(target.url)` hoặc chỉ chuyền hostname cho runtime, Node/undici sẽ **tự lookup DNS lại tại thời
  điểm mở socket** → IP đã-validate ≠ IP thực kết nối, vô hiệu hóa DNS-rebinding guard.
  **Acceptance BẮT BUỘC cho CGHC-011/012:** connect tới đúng IP trong `ConnectTarget.resolved`
  (IP-pinned — dùng `lookup` custom trả về resolved IP, hoặc `Host` header + connect-by-IP), HOẶC
  re-run `assertAllowed`/re-classify **đúng IP mà socket dùng** ngay trước khi gửi byte. Không được tin
  hostname đã validate ở port.

- **F3 (GATE cho CGHC-011/012):** re-validate mỗi hop redirect — provider có thể redirect sang host
  private sau connect; mỗi redirect phải gọi lại `guardedConnect`/`assertAllowed` (ADR 0005
  "re-validate on redirect"). Không follow redirect một cách mù quáng.

## Rủi ro (risks)

- R3 SSRF qua custom endpoint: đã bao phủ literal (thập phân/embed IPv6) + hostname-resolves-private +
  DNS-rebinding tại config→connect. Rủi ro còn lại nằm ở **socket boundary** (F2) và **redirect** (F3) —
  đã ghi thành gate bắt buộc cho CGHC-011/012 ở trên; nếu không tuân, guard bị vô hiệu.
- Google env-name (`GOOGLE_API_KEY` vs `GOOGLE_GENERATIVE_AI_API_KEY`) chưa verify với `@ai-sdk/google`
  live (carry-forward CGHC-001) — tất cả provider `liveTested: false`, không có live call.
- Backstop low-32 (F1) cố ý loại 0.0.0.0/8 để không over-block IPv6 global-unicast phổ biến; dạng IPv6
  non-standard embed IPv4 ngoài các prefix đã liệt kê vẫn được xử lý qua low-32 backstop (trừ 0/8).

## CGHC-011 / CGHC-019 / CGHC-020 tiêu thụ gì

- **CGHC-011** (add credential + test connection): cấp `ProviderConnector` thật (nói chuyện runtime),
  route probe qua `ProviderPort.guardedConnect` (để DNS-rebinding guard bao phủ testConnection), và
  gọi `configureCredential(id, ref)` bằng `CredentialRef` từ CGHC-009. Không echo value ra UI/DOM/log.
- **CGHC-012** (streamChat): bọc runtime SSE call trong `guardedConnect` cho custom endpoint.
- **CGHC-019** (model switch): dùng `configureModel`/`modelSelection` (default + per-session).
- **CGHC-020** (error mapping): mở rộng `mapProviderError` theo body từng provider + tune retry bound.
- Orchestrator: mount `createProviderRouter(port)` lên boundary CGHC-002 với token guard (không
  `publicUnauthenticated`); quyết định `loopbackEscape` qua `productionLoopbackEscape(launchFlag)` từ
  launch-config, tiêm vào `createSsrfPolicy`.
