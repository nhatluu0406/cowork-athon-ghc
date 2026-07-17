---
language: "vi"
status: "accepted"
date: "2026-07-16"
deciders: ["product-owner", "runtime-llm-engineer"]
related: ["0005-provider-abstraction.md", "0003-local-service-transport-placement-loopback.md"]
---

# ADR 0012 — Dev-only opt-in override cho loopback `http` LLM endpoint

## Context

ADR 0005 §"Custom endpoint SSRF policy" khóa outbound SSRF policy: **bắt buộc `https`**; `http`
chỉ được phép trên loopback dưới test-mode escape (`service/src/provider/test-mode.ts`), còn
RFC-1918 / link-local / loopback-không-escape / cloud-metadata đều bị chặn, và IP resolve được
re-validate ở connect time (DNS-rebinding guard). Enforce ở **service** (execution boundary), không
phải UI.

Hệ quả thực tế: một developer muốn trỏ Cowork vào LLM chạy local qua `http` — cụ thể
`http://127.0.0.1:8080` (private-gpt gateway) hoặc Ollama `http://localhost:11434` — bị
`SsrfBlockedError (scheme_not_https)`. Đây là **cái chặn trực tiếp** live dispatch / Checkpoint 5
(`docs/product/current-status.md`, khối "D1 compliance + security review 6.3").

`createSsrfPolicy` (`service/src/provider/ssrf-policy.ts`) **đã có sẵn** knob `loopbackEscape`: khi
bật, `http` chỉ được phép khi **mọi** địa chỉ resolve là loopback (`allLoopback`), còn private /
link-local / cloud-metadata / public-http vẫn bị chặn. Knob này chưa từng được bật ở bất kỳ call
site nào ⇒ nó chết ở runtime.

## Decision

### 1. Thêm một dev-only override, opt-in, OFF mặc định

Env `COWORK_GHC_DEV_ALLOW_LOOPBACK_HTTP` (truthy `"1"`/`"true"`; unset/rỗng/`"0"`/`"false"` ⇒ OFF).
`readDevLoopbackHttpEscape` (`service/src/provider/dev-loopback-http.ts`, thuần env, không I/O)
resolve **một lần** ở mỗi composition root và truyền `loopbackEscape: true` vào **cả bốn** chỗ dựng
`createSsrfPolicy`: `compose-service.ts`, `http-connector-factory.ts`,
`provider-profiles/provider-connection-tester.ts`, và `live-launch.ts` (chỗ validate baseUrl custom
provider **trước khi spawn child** — cái chặn trực tiếp). OFF ⇒ không truyền gì ⇒ mọi site
**byte-for-byte** như trước.

Override này **chỉ bật** knob loopback-only sẵn có; nó **không thể nới** những gì knob làm. Logic
enforce ở `ssrf-policy.ts` **không đổi** (commit chỉ sửa một JSDoc). Test chứng minh: flag ON vẫn
chặn `10.0.0.1` (private), `169.254.169.254` (cloud-metadata), và public host qua http.

### 2. KHÔNG đi qua release hard-assert — và tại sao

`productionLoopbackEscape`/`resolveLoopbackEscape` (`test-mode.ts`) **throw** `ReleaseGuardrailError`
khi flag bật dưới `BUILD_PROFILE === "release"`. `BUILD_PROFILE` là literal `"release"` và **không**
chỗ nào trong build override nó, nên ở runtime nó là `"release"` kể cả với developer **và** app
packaged. Nếu route dev override qua đường đó, bật flag sẽ khiến app **từ chối khởi động** — phá
demo. Vì vậy override này **không chạm** `BUILD_PROFILE`, **không throw**, là một nguồn hợp lệ riêng,
đặt tên rõ là dev-only.

### 3. Chỉ từ env, không bao giờ từ request body

Nguồn duy nhất là `process.env` ở composition root. Provider router (`router.ts`) tiếp tục **bỏ qua**
mọi field `loopbackEscape`/tên-env trong request body (có regression test khẳng định) ⇒ renderer /
nội dung do model sinh **không thể** bật nó.

### 4. Trung thực khi active

Khi bật, compose log banner non-secret qua `bootDiagnostic` sẵn có (không log URL đích, không secret):
`[SSRF] DEV loopback-http override ACTIVE — plain http permitted to loopback ONLY (127.0.0.1/::1);
never use in production.`

## Consequences

- (+) Developer dùng được local loopback LLM (`http://127.0.0.1:8080`, Ollama) như một provider
  OpenAI-compatible, gỡ chặn live dispatch cho dev/demo — không cần dựng TLS local, không cần nới
  policy production.
- (+) An toàn mặc định giữ nguyên: OFF ⇒ byte-for-byte như trước; production không đổi.
- (+) Independent security review (2026-07-16, `36d780a`) **PASS, không HIGH finding**: đã thử phá
  classification bằng `0x7f.0.0.1`, `2130706433`, `127.1`, `[::1]`, userinfo (`127.0.0.1@evil.com`),
  subdomain (`127.0.0.1.evil.com`), `%2f`, trailing-dot, uppercase — WHATWG URL normalize về loopback
  literal thật **trước** classify, không có parser-differential giữa "cái được classify" và "cái được
  connect tới". Private/metadata/public-http vẫn bị chặn khi flag ON.
- (−) **Residual risk (chấp nhận cho dev-only):** khi flag bật (một hành động cố ý của dev), service
  sẽ POST request provider — **kèm `Authorization` bearer chứa key provider** — tới đúng
  `127.0.0.1:<port>` mà dev cấu hình làm `base_url`. Nếu dev vừa bật flag **vừa** trỏ nhầm port sang
  một local service khác, service đó nhận được key. Tương tự mức tin cậy loopback app vốn đã có (app
  bind loopback và nói chuyện với child của chính nó), gated sau env `...DEV...` + banner "never use
  in production", và **không** kích hoạt được từ model/renderer/request. Không phải finding, là
  trade-off của dev-only.
- (−) Flag cũng mới cho phép **https-to-loopback** (trước bị chặn hoàn toàn). Vẫn loopback-only, hẹp
  hơn mức đáng lo — không phải widening.
- (−) DNS-rebinding TOCTOU pre-existing giữa resolver của policy và resolver của HTTP client **không**
  bị đưa vào hay nới rộng ở đây; với http thì gate `allLoopback` ràng buộc. Ngoài scope thay đổi này.

## Alternatives considered

- **Route qua `productionLoopbackEscape` (release-gated escape)** — **bị loại**: throw
  `ReleaseGuardrailError` dưới `BUILD_PROFILE="release"` (luôn đúng ở runtime) ⇒ app từ chối khởi
  động ⇒ phá demo.
- **Bắt developer dựng một reverse proxy `https` local trước gateway** — **bị loại**: ma sát cao cho
  một tiện ích dev; không phù hợp "treat như localhost Ollama".
- **Chỉ dùng `COWORK_GHC_E2E_MOCK_LLM_BASE_URL` (mock LLM loopback)** — **vẫn giữ** cho verification
  deterministic không cần LLM thật, nhưng nó chỉ cho **đúng một** URL mock verifier, không dùng được
  một gateway/Ollama local tùy ý ⇒ không thay thế được nhu cầu này.
- **Nới policy production cho http-on-loopback mặc định** — **bị loại**: đổi mặc định an toàn của
  production; override opt-in OFF-by-default giữ nguyên mặc định.

## Requirements traceability

- ADR 0005 §"Custom endpoint SSRF policy" — ADR này **bổ sung (additive)** một nguồn opt-in dev-only
  cho knob `loopbackEscape` sẵn có; **không đổi** enforcement production (mặc định vẫn https-only).
- Cái chặn: `docs/product/current-status.md` (khối "D1 compliance + security review 6.3" và hotfix
  SSRF) — Checkpoint 5 cần provider hợp lệ.
- Commit: `36d780a`. Security review độc lập: PASS (không HIGH).

## Open items

- **CI/lint chặn override lọt vào release**: hiện dựa vào tên env + banner + review. Cân nhắc một
  guard build/CI cảnh báo nếu env này xuất hiện trong cấu hình packaged.
- **DNS-rebinding TOCTOU** (pre-existing, ngoài scope) giữa policy resolver và HTTP client resolver.
- Nếu sau này cần dùng loopback http trong bối cảnh rộng hơn dev (vd một chế độ "local-first" chính
  thức), cần ADR riêng — override này KHÔNG phải cửa cho điều đó.
