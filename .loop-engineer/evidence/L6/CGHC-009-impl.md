---
task: "CGHC-009"
loop: "L6"
title: "Credential store — single OS-backed store (@napi-rs/keyring), handle-only state, inject-at-launch"
language: "vi"
status: "implemented"
adr_refs: ["0006", "0005", "0001", "0003"]
requirement: "PR9 / SEC-1 / SEC-2"
date: "2026-07-11"
review: "PASS_WITH_FINDINGS (0 Crit/High); MEDIUM scrubber-duplication/AC4-diagnostics-gap ĐÃ ĐÓNG (xem §9)"
---

# CGHC-009 — Bằng chứng triển khai (service/src/credential/)

## 1. Đã xây dựng cái gì

Đơn vị nhạy cảm bảo mật nhất (SEC-1): **một** credential store OS-backed duy nhất qua
`@napi-rs/keyring` (Windows Credential Manager), mô hình hoá bằng **port `CredentialStore`**
với adapter keyring thật + fake in-memory, để logic test được mà production dùng vault thật.
State ứng dụng chỉ giữ **`CredentialRef`** (handle), không bao giờ giữ giá trị key. Key được
**resolve chỉ ở biên inject-at-launch** và bơm vào env child spawn qua seam `injectionFor`
(CGHC-001), **không bao giờ ghi `auth.json`/`env.json`** hay bất kỳ file nào.

Module nhỏ, cohesive (mọi file < 250 dòng), TypeScript strict, không `any`:

- `store.ts` — port `CredentialStore` (async `set`/`get`/`delete`), `CREDENTIAL_SERVICE_NAME`
  ("cowork-ghc"), `credentialAccountFor()` (account handle deterministic, allowlist ký tự
  `[A-Za-z0-9:._-]`, secret-free), `credentialRef()`, và error types
  (`CredentialStoreError`/`CredentialNotFoundError`) — message **không bao giờ** chứa secret.
- `keyring-adapter.ts` — adapter thật `@napi-rs/keyring` (lazy `import()`, map lỗi native →
  `KeyringUnavailableError`), `createKeyringStore()`, và `keyringAvailable()` (probe
  set/get/delete tự dọn, không ném) cho test gated skip mượt.
- `memory-store.ts` — fake in-memory (Map), **không đụng filesystem** — dùng cho CI/sandbox.
- **Scrubbing = MỘT nguồn duy nhất (CGHC-021):** KHÔNG còn `credential/scrubber.ts`. Credential
  service **consume** `SecretScrubber` của CGHC-021 qua barrel `../diagnostics/index.js` (cùng
  package `service`, import intra-package hợp lệ). Composition root **inject một instance shared
  duy nhất**; `credentialService.scrubber` trỏ vào chính instance đó → dùng chung cho credential
  audit, diagnostics logger, execution-metadata, bundle export, error path. Placeholder
  `[REDACTED]` (CGHC-021). Env-map giữ helper CGHC-001 (`redactedLaunchEnv`/`envMapContainsNoSecret`)
  cho snapshot whole-value — bổ trợ, không trùng.
- `credential-service.ts` — domain logic: nhận `scrubber?: SecretScrubber` qua factory param
  (production truyền instance shared; test standalone default-construct). `store()` (nhận secret →
  trả **chỉ** `CredentialRef`, `register(secret)`, audit line đã-scrub), `resolveInjection()`
  (**điểm DUY NHẤT** key rời store, tại biên inject; `register({value, label: envVar})` **TRƯỚC**
  khi key vào launch env → mọi sink hạ nguồn được phủ bằng một `register()` → **đóng AC4**), `has()`,
  `remove()`. Không ghi đĩa; audit line luôn đi qua scrubber shared trước khi tới sink.
- `inject.ts` — glue compose với runtime: `resolveInjections()`, `buildLaunchSpecWithCredentials()`
  (bơm key vào env child qua `buildLaunchSpec` thuần, không I/O), `redactedLaunchEnv()`
  (view log-safe qua `redactedEnvSnapshot` CGHC-001).
- `router.ts` — `createCredentialRouter()`: `POST /v1/credentials` (body có secret **inbound
  only** → trả **chỉ** `{ ref }`), `DELETE /v1/credentials`. **Mọi route token-guarded** (không
  `publicUnauthenticated` — cấm với route credential). Không log/echo secret.
- `index.ts` — barrel cục bộ (KHÔNG sửa `service/src/index.ts`; orchestrator wire sau).

`service/package.json`: thêm dependency `@napi-rs/keyring@1.3.0` (MIT) — biến thể prebuilt
native `keyring-win32-x64-msvc` cài kèm — cùng workspace dep `@cowork-ghc/runtime` + `@cowork-ghc/contracts`
(cần cho seam `injectionFor`/`ProviderEnvSpec` và `CredentialRef`). `npm install` từ repo root OK.

## 2. Ánh xạ Acceptance → code

| Acceptance | Nơi thoả mãn |
|---|---|
| **AC (single OS store, state chỉ giữ CredentialRef)** | `store.ts` (port + `credentialRef`), `keyring-adapter.ts` (adapter Windows Credential Manager), `credential-service.ts::store` trả handle-only. Test: `credential-reference.test.ts`. |
| **AC (key inject env đúng per-provider vào child spawn; không ghi auth.json/env.json)** | `credential-service.ts::resolveInjection` + `inject.ts::buildLaunchSpecWithCredentials` reuse `injectionFor`/`buildLaunchSpec` (CGHC-001). Test: `credential-redaction.test.ts` (assert key ở `env[primaryEnvVar]`, và **không** có `auth.json`/`env.json`, không file nào chứa key). |
| **AC1** — key resolve **chỉ trong service**, tại child launch | `resolveInjection` là điểm duy nhất `store.get` được gọi; router không trả value. |
| **AC2** — key không persist ra đĩa/backup/diagnostics | không module nào ghi đĩa; test quét đệ quy run dir → 0 file chứa key. |
| **AC3** — key không sang renderer (state/DOM/local storage) | `store()`/router trả `{ ref }`; test serialize app-state + response body assert vắng key. |
| **AC4** — redact theo VALUE ở mọi nơi (kể cả diagnostics + execution-metadata) | **MỘT** scrubber shared của CGHC-021; `resolveInjection` `register()` key một lần → phủ diagnostics bundle / execution-metadata / logs / error path. + `redactedLaunchEnv`/`envMapContainsNoSecret` (env-map bổ trợ). Test: "one SHARED scrubber ... covers diagnostics + execution-metadata (AC4)". |
| **AC5** — negative test cho **standard AND custom** | `credential-redaction.test.ts` chạy 2 lượt: openai (standard) + custom OpenAI-compatible. |
| **AC6** — env injection là kênh mặc định & duy nhất | chỉ có đường `resolveInjection → injectionFor → buildLaunchSpec.env`; không có code path ghi file key. |
| **SEC-2** — scrubber match VALUE không phải NAME | CGHC-021 `SecretScrubber` (substring theo giá trị, longest-first, `[REDACTED]`). Test: dòng free-form nhúng key + object graph diagnostics đều bị scrub. |

## 3. Chứng minh AC1–AC6 (standard + custom)

- **Standard (openai):** store key → `ref={store:"os",account:"provider:openai"}`; resolve →
  `{envVar:"OPENAI_API_KEY", value:<key>}`; `spawnSpec.env.OPENAI_API_KEY === key` (in-memory,
  per-launch) nhưng `redactedLaunchEnv` → `<redacted>` và `envMapContainsNoSecret(redacted,[key])===true`.
  Quét run dir: không `auth.json`/`env.json`, không file chứa key. Không log line chứa key.
- **Custom (OpenAI-compatible, `providerId:"my-llm"`, `envVar:"MY_LLM_API_KEY"`):** cùng chu trình,
  env var do user đặt, `ref.account==="provider:my-llm"`; các assert vắng-key y hệt. (Base URL do
  user cung cấp ở tầng provider-env — ngoài phạm vi store, đúng ADR 0006.)
- **AC3 qua router:** `POST /v1/credentials` thiếu token → **401**; có token → **201** với body chỉ
  chứa `{ ref }` (assert `rawText` không chứa key). Không route credential nào `publicUnauthenticated`.

## 4. Test — lệnh chính xác + PASS thật

Lệnh (chạy trong `service/`):

```
node --import tsx --test "tests/credential-*.test.ts"
```

Output đuôi thật (PASS, đã typecheck `tsc -b service/tsconfig.json --force` EXIT 0):

```
✔ real Windows Credential Manager round-trip via @napi-rs/keyring (42.2186ms)
✔ no key at rest / no key in logs — STANDARD provider (openai) (6.4785ms)
✔ no key at rest / no key in logs — CUSTOM provider (OpenAI-compatible) (2.9936ms)
✔ the scrubber masks a key that would otherwise reach a log line (SEC-2, value-based) (0.2835ms)
✔ one SHARED scrubber, registered at injection, covers diagnostics + execution-metadata (AC4) (0.5943ms)
✔ storing a key returns a handle-only CredentialRef (never the value) (2.005ms)
✔ app state serializes the ref only; the key is not in the persisted snapshot (0.4568ms)
✔ resolving the ref yields the value only at the injection boundary (0.5489ms)
✔ custom OpenAI-compatible provider: handle-only ref + own env var at the boundary (0.3929ms)
✔ a dangling ref throws CredentialNotFoundError (no value invented) (1.1404ms)
✔ an empty secret is rejected before anything is stored (0.5233ms)
✔ credential store route requires the token and returns the ref only (no key) (59.7909ms)
✔ credential delete route requires the token and reports removal (10.8915ms)
ℹ tests 13
ℹ pass 13
ℹ fail 0
```

Full service suite (không regress): `node --import tsx --test "tests/**/*.test.ts"` → **57 pass / 0 fail**.
Không còn entry keyring rớt lại (`findCredentials("cowork-ghc") === 0`).

**Ghi chú test native (gated skip):** test round-trip `@napi-rs/keyring` thật **CHẠY THẬT VÀ PASS**
trên sandbox Windows này (native binding `keyring-win32-x64-msvc` có sẵn; ghi/đọc/xoá vault thật với
account throwaway `cghc009-keyring-selftest`, đã dọn). Nếu môi trường khác thiếu native binding hoặc
Credential Manager, `keyringAvailable()` trả `false` → test **skip mượt có tài liệu** (`t.skip(...)`),
còn toàn bộ logic handle/ref/redaction/no-at-rest vẫn PASS qua fake in-memory.

## 5. M4 — Live-verify gating note (carry-forward từ CGHC-001 review, KHÔNG fix ở đây)

Theo `.loop-engineer/evidence/L6/CGHC-001-impl.md` (M4): khẳng định **"runtime OpenCode thật
không bao giờ ghi `auth.json`/`env.json` khi được lái theo cách này"** hiện mới **stub-proven**
(chưa có binary OpenCode thật trong test). Bằng chứng CGHC-009 chứng minh: (a) code Cowork GHC
không có đường ghi key ra đĩa, (b) key chỉ vào env child in-memory. **Nhưng** để coi SEC-1 là
**validated đầy đủ**, cần một **verify LIVE, opt-in, bounded** với **binary đã pin (v1.17.11)**:
spawn thật với key inject qua env, xác nhận không sinh `auth.json`/`env.json` (không cần gọi LLM).
**Task này KHÔNG chạy binary/LLM thật** (đúng gating Wave 1). Đây là điều kiện chấp nhận còn treo
của SEC-1, gated theo pin ADR 0001; bump pin thì re-verify.

## 6. Xác nhận không rò key ra đĩa/log/state

- **Đĩa:** không module nào import ghi file cho key; test quét đệ quy run dir → 0 file chứa key,
  0 `auth.json`, 0 `env.json`. Store thật duy nhất là Windows Credential Manager.
- **Log:** mọi audit line đi qua `scrubber.scrub` trước sink; test assert không line nào chứa key;
  env snapshot log-safe qua `redactedLaunchEnv` (`<redacted>`) + `envMapContainsNoSecret===true`.
- **State/renderer:** `store()`/router trả **chỉ** `CredentialRef`; test serialize app-state +
  response body khẳng định vắng key (AC3). Không key trong browser local storage (state là handle-only).

## 7. Giả định

- Account handle mặc định `provider:<providerId>` (một credential/provider). Nhiều credential/provider
  hoặc account tuỳ biến: truyền `account` tường minh (đã validate allowlist ký tự). Store service name
  = `cowork-ghc` (một namespace duy nhất).
- Port `CredentialStore` async cho cả adapter native (sync `Entry` bọc Promise) lẫn fake — một interface.
  Dùng `Entry` sync bọc Promise (đơn giản, POC); có `AsyncEntry` nếu sau này cần non-blocking.
- Router validation lỗi (body xấu) ném `CredentialRequestError` → boundary map thành lỗi generic 500
  (contract CGHC-002 chỉ surface error type của chính boundary). An toàn secret (không rò), nhưng UX
  lỗi phong phú (400 có mã) là việc của task error-mapping — ghi ở rủi ro.
- Không sửa `service/src/index.ts`; barrel `service/src/credential/index.ts` export service + router
  để orchestrator mount lên boundary (token-guard mặc định).

## 8. Rủi ro / carry-forward

- **SEC-1 live verify (M4):** như §5 — cần live opt-in bounded với binary pinned trước khi đóng SEC-1.
- **Error-mapping route:** body xấu hiện → 500 generic (không rò secret). Task error-mapping nên map
  `CredentialRequestError` → 400 `bad_request` khi mở rộng `BoundaryErrorCode`/`fail()`.
- **Packaging native (ADR 0004/0006):** `@napi-rs/keyring` là prebuilt N-API; khi đóng gói Electron cần
  asarUnpack-class cho binary native (ngoài phạm vi task này).
- **Multi-account/rotation:** rotation key (ghi đè cùng account) đã hỗ trợ (`set` overwrite); UX rotation
  + audit event thuộc provider/settings task.
- **`RuntimeLaunchSpec` plaintext caveat (carry-forward, KHÔNG fix ở đây):** `spec.env`/`secretValues`
  là plaintext in-memory; hạ nguồn quan sát spec PHẢI dùng scrubber shared / `redactedLaunchEnv`
  trước khi log/serialize — không bao giờ log raw spec.

## 9. MEDIUM đã đóng — hợp nhất scrubber về MỘT nguồn (security review CGHC-009)

Review độc lập = PASS_WITH_FINDINGS (0 Crit/High). MEDIUM: trùng lặp scrubber + hở AC4 diagnostics
(instance riêng của credential khiến nửa diagnostics/execution-metadata chưa được wire). **Đã đóng:**

1. **Xoá `service/src/credential/scrubber.ts`** — không còn scrubber value-based thứ hai.
2. **Consume `SecretScrubber` của CGHC-021** từ `../diagnostics/index.js` (`register`/`scrub`/
   `scrubDeep`/`scrubJson`/`containsSecret`, placeholder `[REDACTED]`). Barrel credential re-export
   `createSecretScrubber`/`SecretScrubber` từ diagnostics (một nguồn).
3. **Dependency-inject instance shared:** `createCredentialService({ scrubber })` nhận instance qua
   factory param; production truyền instance shared duy nhất (dùng chung credential audit + diagnostics
   logger + execution-metadata + bundle + error path). Test standalone mới default-construct.
   `credentialService.scrubber` trỏ đúng instance được inject (test khẳng định `service.scrubber === shared`).
4. **Register-at-injection:** `resolveInjection` gọi `scrubber.register({value, label: envVar})` **trước**
   khi key vào launch env — một `register()` phủ mọi sink hạ nguồn → **đóng AC4** (diagnostics +
   execution-metadata trước đây hở vì instance tách rời).
5. **Giữ helper env-map CGHC-001** (`redactedLaunchEnv`/`envMapContainsNoSecret`) cho snapshot whole-value
   — bổ trợ, không trùng free-form scrubber.
6. **Test cập nhật + xanh:** thêm test "one SHARED scrubber ... covers diagnostics + execution-metadata
   (AC4)"; standard+custom AC1–AC6 negative vẫn xanh. Credential **13/13 pass**; full suite **57/57 pass**;
   `tsc -b service/tsconfig.json` EXIT 0.

**Carry-forward (KHÔNG fix ở task này, ghi nhận):** (a) LOW body xấu → 500 generic (map
`CredentialRequestError` → 400 thuộc bước boundary error-mapping); (b) M4 live SEC-1 verify với binary
pinned (§5); (c) caveat plaintext `RuntimeLaunchSpec` ở trên.
