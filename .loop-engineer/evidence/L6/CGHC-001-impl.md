---
task: "CGHC-001"
loop: "L6"
title: "Runtime OpenCode: pin, launch/config, keyless env-name spike, process identity"
language: "vi"
status: "implemented"
date: "2026-07-11"
review: "PASS_WITH_FINDINGS (0 Critical/High); hardening M1/M3/L5/L6 đã áp dụng"
---

# CGHC-001 — Bằng chứng triển khai (runtime/)

## 1. Đã xây dựng cái gì

Toàn bộ nằm trong subtree `runtime/` (workspace `@cowork-ghc/runtime`), TypeScript strict,
test bằng `node --import tsx --test`. Các module nhỏ, cohesive (mỗi file < 250 dòng):

- `runtime/src/pin.ts` — **single source of truth** cho version OpenCode được pin
  (`OPENCODE_PIN = "v1.17.11"`), cùng cổng gate: `normalizeVersion`, `isPinnedVersion`,
  `checkPin`, `assertPinnedVersion` (+ `PinMismatchError`), và `runtimeVersionInfo()` để
  surface version runtime cho SD7. Không dùng dải `^`/`~` — chỉ một giá trị tường minh.
- `runtime/src/provider-env.ts` — **kết quả keyless env-name spike**: map typed
  `BUILTIN_PROVIDER_ENV` cho openai / anthropic / openrouter / google, plus
  `customOpenAiCompatibleEnv()` cho provider OpenAI-compatible do người dùng tự định nghĩa
  (env var name + base URL do user cung cấp). Map được `Object.freeze`.
- `runtime/src/launch-config.ts` — `buildLaunchSpec()` thuần (không I/O, không spawn): dựng
  `opencode serve` bằng **mảng args** (không chuỗi shell), cô lập dữ liệu per-run qua env
  `XDG_DATA_HOME` + `OPENCODE_CONFIG_DIR`, và **inject provider key chỉ vào env child spawn**.
  Không bao giờ ghi `auth.json`/`env.json`. `redactedEnvSnapshot()` che secret theo **VALUE**.
- `runtime/src/process-identity.ts` — identity = `{ pid, startTime, exePath, port, host,
  runtimeVersion }`; `captureIdentity()` (frozen, deterministic), `parseIdentityRecord()`
  (validate record không tin cậy, total), `identityMatches()` (re-match PID + start-time +
  exePath để một PID tái sử dụng không bị kill nhầm — LC3). Không có identityToken.
- `runtime/src/redact.ts` — che secret **env-map** theo VALUE (`redactEnvMapValues`,
  `envMapContainsNoSecret`); JSDoc scope rõ: KHÔNG dùng cho chuỗi free-form (M3).
- `runtime/src/env-name.ts` — `isValidEnvName` (single source, dùng chung ở provider-env +
  launch-config — DRY, L6).
- `runtime/src/index.ts` — public surface cho Local Service.
- `runtime/package.json`, `runtime/tsconfig.json` (extends `../tsconfig.base.json`).

## 2. Ánh xạ Acceptance → code

| Acceptance | Thỏa mãn ở đâu |
|---|---|
| AC1 — pin theo ADR 0001; glue spawn cô lập per-run bằng `XDG_DATA_HOME` + `OPENCODE_CONFIG_DIR` (OpenCode **không có** `--data-dir`) | `pin.ts` (`OPENCODE_PIN`), `launch-config.ts` (`buildEnv` set 2 env; args không chứa `--data-dir`) |
| AC2 — keyless env-name spike: tên env var chính xác cho 5 lớp provider; key inject qua env, **không** ghi auth.json | `provider-env.ts` (map typed + custom builder); `launch-config.ts` (inject env-only); test `process-identity.test.ts` assert không có `auth.json`/`env.json` |
| AC3 — surface version runtime (SD7) và gate về pin ADR 0001 (mismatch phát hiện/từ chối được) | `pin.ts` (`runtimeVersionInfo`, `checkPin`, `assertPinnedVersion`, `PinMismatchError`) |
| Test — runtime process identity: identity capture/parse deterministic + spawn stub child chứng minh env-injection + data-isolation, không ghi auth.json | `process-identity.test.ts` (spawn `fixtures/env-probe-child.mjs`) |
| Test — pin/upgrade gate | `pin.test.ts` |

## 3. Kết quả keyless env-name spike (tên env var đã xác nhận)

OpenCode đọc credential provider từ **process env** theo registry models.dev, trong đó
`env[0]` là credential chính (ghi chú tham chiếu:
`.loop-engineer/source/openwork/apps/app/src/react-app/domains/connections/provider-auth/cloud-provider-config.ts:42-47`).

Tên cụ thể xác nhận từ catalog models.dev được cache trong reference (chỉ **đọc để xác nhận
sự thật** — KHÔNG copy, KHÔNG là build dependency; file này nằm dưới `/ee` Fair Source nên
tuyệt đối không copy code):
`.loop-engineer/source/openwork/ee/apps/inference/src/models/base.json:1`

| Provider | primaryEnvVar (inject) | acceptedEnvVars (OpenCode đọc) | npm adapter | baseURL |
|---|---|---|---|---|
| openai | `OPENAI_API_KEY` | `["OPENAI_API_KEY"]` | `@ai-sdk/openai` | — |
| anthropic | `ANTHROPIC_API_KEY` | `["ANTHROPIC_API_KEY"]` | `@ai-sdk/anthropic` | — |
| openrouter | `OPENROUTER_API_KEY` | `["OPENROUTER_API_KEY"]` | `@openrouter/ai-sdk-provider` | `https://openrouter.ai/api/v1` |
| google (Gemini) | `GOOGLE_API_KEY` | `["GOOGLE_API_KEY","GOOGLE_GENERATIVE_AI_API_KEY","GEMINI_API_KEY"]` | `@ai-sdk/google` | — |
| OpenAI-compatible (user-defined) | **do user đặt** (vd `REQUESTY_API_KEY`, `DASHSCOPE_API_KEY`) | 1 tên do user đặt | `@ai-sdk/openai-compatible` | do user đặt (`api`) |

Ghi chú Google/Gemini: models.dev list cả 3 tên; `env[0]=GOOGLE_API_KEY` là primary theo
quy ước. Cả 3 đều được OpenCode chấp nhận nên `acceptedEnvVars` giữ đủ để redaction/detection
phủ hết. Tên `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY` còn được xác nhận chéo
trong app OpenWork (vd `apps/app/src/app/extensions.ts:246`,
`apps/app/tests/cloud-provider-credentials.test.ts:18`).

Xác nhận **OpenCode không có cờ `--data-dir`**: cờ `--data-dir` duy nhất trong reference thuộc
`openwork-orchestrator daemon run` (`apps/desktop/electron/runtime.mjs:1323-1327`), KHÔNG phải
`opencode`. Vị trí dữ liệu OpenCode do env quyết định: đọc `XDG_DATA_HOME`
(`apps/server/src/opencode-db.ts:50-57`), và dev-mode set cả `XDG_DATA_HOME` +
`OPENCODE_CONFIG_DIR` cho child (`runtime.mjs:798,801`; `ensureDevModePaths` 751-767).

Xác nhận **không ghi auth.json**: SEC-1 (design §6) cấm ghi `auth.json`/`env.json` của OpenCode;
kênh hợp lệ duy nhất là inject env vào spawn (mẫu tham chiếu `managed-opencode.ts:73-95` chỉ
đưa key qua env child, không ghi file).

## 4. Test — lệnh và output thật

Lệnh:

```
cd runtime && node --import tsx --test "test/**/*.test.ts"
```

Đuôi output thật (PASS, sau hardening review):

```
✔ loopback host passes; a non-loopback host is rejected (loopback-only invariant)
✔ env-map redaction is whole-value scoped (documents the M3 boundary)
✔ spawned child receives injected provider key + isolation env, and no auth.json is written (74.5259ms)
✔ confirmed built-in provider env var names (keyless spike, models.dev base.json:1)
✔ google accepts all three env names OpenCode reads
✔ user-defined OpenAI-compatible provider carries its own env name + base URL
✔ custom provider rejects an unsafe env var name
ℹ tests 23
ℹ pass 23
ℹ fail 0
ℹ duration_ms 414.7495
```

Typecheck strict: `cd runtime && npx tsc -b` → exit 0 (No errors found).

## 4b. Hardening sau independent review (PASS_WITH_FINDINGS)

- **M1 — enforce loopback host:** `buildLaunchSpec` giờ chỉ chấp nhận host ∈
  `{127.0.0.1, ::1, localhost}`; host khác (vd `0.0.0.0`, IP LAN) ném
  `NonLoopbackHostError` (typed). Test mới: loopback pass, non-loopback bị từ chối,
  default vẫn loopback.
- **M3 — scope redaction helpers:** đổi tên `redactEnvValues`→`redactEnvMapValues`,
  `containsNoSecret`→`envMapContainsNoSecret`; JSDoc + module scope nêu rõ CHỈ dùng cho
  env-map (whole-value equality), KHÔNG dùng cho chuỗi free-form (substring secret sẽ
  lọt). Free-form scrubber để CGHC-021. Test mới chứng minh ranh giới này.
- **L5 — narrow child env + cảnh báo raw spec:** JSDoc trên `RuntimeLaunchSpec` cảnh báo
  `.env`/`.secretValues` chứa plaintext, không bao giờ log — chỉ `redactedEnvSnapshot()`
  an toàn; JSDoc trên `baseEnv` khuyến nghị service truyền allowlist curated
  (PATH/SystemRoot/TEMP/…) thay vì kế thừa toàn bộ `process.env`.
- **L6 — DRY regex tên env:** tách `isValidEnvName` vào `env-name.ts`, dùng chung ở
  `provider-env.ts` + `launch-config.ts` (bỏ regex trùng lặp).

Test process-identity dùng **stub child thật** `runtime/test/fixtures/env-probe-child.mjs`
(in `process.env` ra JSON). Không có binary OpenCode thật; không frame nào bị bịa. Test assert:
`XDG_DATA_HOME` + `OPENCODE_CONFIG_DIR` + `ANTHROPIC_API_KEY` đến đúng child, và **không**
tồn tại `auth.json`/`env.json` trong thư mục run.

## 5. Giả định

- `startTime` thật của OpenCode child trên Windows sẽ lấy từ `Get-CimInstance Win32_Process`
  CreationDate (design §8). Test hiện chụp mốc thời gian tại thời điểm spawn để chứng minh
  luồng capture deterministic; module chấp nhận `Date | string` và chuẩn hóa về ISO. Việc đọc
  CreationDate thật thuộc CGHC lifecycle/supervision (ADR 0004) — ngoài phạm vi task này.
- Version báo cáo runtime để gate sẽ lấy từ `/global/health` (`{healthy, version}`, design §8);
  `checkPin`/`assertPinnedVersion` nhận chuỗi version và chuẩn hóa `v` đầu. Việc gọi HTTP health
  thuộc supervision, không nằm ở đây.
- Credential được **resolve** ở service (ADR 0006, Windows Credential Manager); module runtime
  chỉ nhận `{ envVar, value }` đã resolve và inject. Runtime không truy cập credential store.

## 6. Rủi ro cần gate task hạ nguồn

- **CGHC-010 (provider port):** tên env đã chốt trong `BUILTIN_PROVIDER_ENV`. Với Google nên
  inject `GOOGLE_API_KEY` (env[0]) làm mặc định, nhưng nếu bản OpenCode pinned/`@ai-sdk/google`
  ưu tiên đọc `GOOGLE_GENERATIVE_AI_API_KEY` thì cần verify live (opt-in) trước khi coi Google là
  “live-tested”. Hiện đánh dấu **chưa live-tested** cho toàn bộ provider (chưa gọi provider thật).
- **CGHC-009 (credential store):** runtime KHÔNG ghi key ra đĩa và KHÔNG gọi `auth.json`; store
  đơn nhất phải là Windows Credential Manager. `injectionFor()` là seam nhận value đã resolve —
  CGHC-009 phải bảo đảm value không rơi vào log/diagnostics (đã có `redactEnvValues` theo VALUE).
- **CGHC-024 (pin/upgrade gate harness):** khi bump pin phải re-capture fixtures SSE thật; test ở
  đây chỉ phủ logic gate version, chưa phủ contract SSE (đúng phạm vi task).
- Provider OpenAI-compatible: tên env + baseURL do user đặt → cần validate ở tầng provider/UI
  (đã chặn tên env không hợp lệ ở `customOpenAiCompatibleEnv` và `buildLaunchSpec`).

### Carry-forward gating items từ independent review (KHÔNG fix ở task này)

- **M2 → CGHC-004 (supervision/lifecycle):** `startTime` PHẢI lấy từ `Win32_Process`
  `CreationDate` ở CẢ hai phía — capture VÀ re-match trước khi kill — chứ không phải mốc
  wall-clock tại thời điểm spawn. Nếu dùng wall-clock, bảo vệ chống PID-reuse (LC3) bị vô
  hiệu (một PID tái sử dụng có thể khớp nhầm). Module `process-identity.ts` đã nhận
  `Date | string` và chuẩn hóa ISO, nên CGHC-004 chỉ cần bơm CreationDate thật vào cả
  `captureIdentity` và nhánh so khớp `identityMatches`. **Đây là điều kiện chấp nhận của
  CGHC-004.**
- **M4 → CGHC-009 (credential store):** test “no auth.json at rest” hiện là **stub proof**
  (không có binary OpenCode thật). SEC-1 “runtime thật không bao giờ ghi auth.json/env.json”
  cần một **verify live, opt-in, có giới hạn** với binary đã pin (không gọi LLM) TRƯỚC khi
  CGHC-009 coi SEC-1 là đã validate đầy đủ. Chưa chạy binary/LLM thật trong task này.
