---
task: "CGHC-021"
loop: "L6"
title: "Value-based redaction + diagnostics (scrubber, redacting logger, bundle export)"
language: "vi"
status: "implemented"
date: "2026-07-11"
adr_refs: ["0006", "0003"]
requirement: "PR8"
---

# CGHC-021 — Bằng chứng triển khai (service/src/diagnostics/)

## 1. Đã xây dựng cái gì

Toàn bộ nằm trong `service/src/diagnostics/` (package `@cowork-ghc/service`), TypeScript strict,
Node builtins-only (không thêm dependency, không sửa `service/package.json`). Mỗi file < 250 dòng,
cohesive. Barrel cục bộ `service/src/diagnostics/index.ts` (KHÔNG sửa `service/src/index.ts` —
orchestrator wire sau).

- `secret-scrubber.ts` — **scrubber value-based, free-form (SEC-2)**. Đăng ký các **secret VALUE**
  (từ tầng credential, truyền vào — không hard-code). Khớp secret như **SUBSTRING** của bất kỳ chuỗi
  tự do nào (log line, command line, stack, JSON) và thay bằng placeholder `[REDACTED]`. Có
  `scrub` (chuỗi), `scrubDeep` (object/array), `scrubJson` (serialize + scrub — mạnh nhất),
  `containsSecret`. Type value-bearing `RegisteredSecret` được giữ **service-private** ở đây (barrel
  `core/contracts` cố ý KHÔNG export type mang secret plaintext). Guard `MIN_SECRET_LENGTH = 4`:
  secret < 4 ký tự bị bỏ qua để tránh phá hủy diagnostics (khớp guard tham chiếu `secret.length < 4`).
  Sort secret theo độ dài giảm dần để scrub xác định khi có overlap.
- `redacting-logger.ts` — **logger redact-by-default, verbose off-by-default (SD3)**. Mọi message +
  mọi field structured đi qua scrubber TRƯỚC khi tới sink. `verbose = false` mặc định; bật verbose
  CHỈ mở phát `debug`, **không** tắt redaction. Không tồn tại code path phát record chưa-scrub.
  `createBufferSink()` giữ record trong bộ nhớ (feed bundle + test); `consoleSink` là egress mặc định.
- `execution-metadata.ts` — **execution-metadata record + scrub theo VALUE (AC4)**. `ExecutionMetadata`
  = `{ command, args, cwd, env[], pid?, startedAt?, exitCode?, lastStdout?, lastStderr? }`.
  `scrubExecutionMetadata` chạy MỌI trường chuỗi qua scrubber; env entry mang secret bị đánh dấu
  `redacted: true`. `exportExecutionMetadataJson` = scrub structured + scrubJson (defense-in-depth).
- `diagnostics-bundle.ts` — **export bundle (SD2/SD4/SD7)**. `RuntimeStatus` (SD2, run-state trung
  thực) + `VersionInfo { coworkGhc, runtime }` (SD7). `composeDiagnosticsBundle` dựng snapshot;
  `exportDiagnosticsBundleJson` chạy pass `scrubJson` cuối trên bundle serialized — bảo đảm secret
  xuất hiện 0 lần. Status/version do caller cung cấp từ nguồn sống, module **không bịa** trạng thái.
- `error-redaction.ts` — **seam scrub-before-emit** cho error path CGHC-002 + audit CGHC-016.
  `redactErrorForEmit(scrubber, err)` → message client-safe, không lộ stack; `redactMessageForEmit`
  cho chuỗi message boundary.
- `index.ts` — barrel cục bộ.

## 2. Acceptance → nơi thỏa mãn (code mapping)

| Acceptance | Thỏa ở đâu |
|---|---|
| **AC1** — scrubber khớp secret **VALUE** (không chỉ tên env), match free-form substring; phủ **diagnostics bundle** VÀ **execution-metadata record**; đăng ký secret truyền vào, không hard-code | `secret-scrubber.ts` (`scrub`/`scrubDeep`/`scrubJson`, `register`), `execution-metadata.ts` (`scrubExecutionMetadata`), `diagnostics-bundle.ts` (`exportDiagnosticsBundleJson`) |
| **AC2** — log redact mặc định; verbose off-by-default; bật verbose KHÔNG tắt redaction (SD3) | `redacting-logger.ts` (`verbose ?? false`; `debug` gate chỉ chặn phát; `emit` luôn scrub) |
| **AC3** — runtime status (SD2) + cả 2 version Cowork GHC & runtime (SD7) trung thực; secret bị scrub mọi nơi (PR8); logger redact + export bundle (SD4) tái dùng cùng scrubber | `diagnostics-bundle.ts` (`RuntimeStatus`/`VersionInfo`, caller cấp giá trị), `redacting-logger.ts` + `diagnostics-bundle.ts` chia sẻ 1 `SecretScrubber` |

## 3. Chứng minh VALUE-based (substring) vs NAME-based

Test `diagnostics-scrubber.test.ts`:
- **"scrubs the secret VALUE embedded as a substring"**: secret là substring trong log line
  (`OPENAI_API_KEY=<value> at boundary`), command line (`--token <value>`), stack frame
  (`Bearer <value>`) → cả 3 bị redact.
- **"the env-var NAME alone is NOT the trigger — only the VALUE is"**: chuỗi
  `set OPENAI_API_KEY in Windows Credential Manager` (chỉ có TÊN, không có VALUE) → **giữ nguyên**,
  `containsSecret === false`. Chuỗi `OPENAI_API_KEY=<value>` → tên `OPENAI_API_KEY` được giữ, VALUE bị
  thay: kết quả đúng bằng `OPENAI_API_KEY=[REDACTED]`. Đây là bằng chứng phân biệt name vs value:
  redaction kích hoạt bởi VALUE, không bởi NAME (đối lập anti-pattern `SECRET_ENV_PATTERN.test(name)`).

## 4. Chứng minh bundle-grep-0-hits (bundle AND execution-metadata)

Test `diagnostics-bundle.test.ts` (secret giả `sk-FAKE-bundle-value-...`, không phải key thật):
- **execution-metadata**: dựng record thật cắm secret ở arg (`--inline-key=<value>`), cwd
  (`.../keycache/<value>`), env value (`OPENAI_API_KEY=<value>`, `AUTH_HEADER=Bearer <value>`),
  `lastStdout`. Sanity assert record thô CÓ chứa secret. Sau `exportExecutionMetadataJson` →
  `countOccurrences(json, FAKE_KEY) === 0`. Thêm: env entry `OPENAI_API_KEY` bị flag `redacted: true`,
  entry `PATH` (không secret) giữ `redacted: false`.
- **diagnostics bundle**: logger thật (verbose bật) ghi info/error/debug đều dính secret → buffer feed
  bundle. Bundle gồm versions + status + logs + execution (cắm secret). Sau
  `exportDiagnosticsBundleJson` → `countOccurrences(json, FAKE_KEY) === 0` cho TOÀN artifact.
  Parse lại: `versions.coworkGhc/runtime`, `runtimeStatus.state="running"`, `logging.verbose=true`
  đúng như cấp (SD2/SD7/SD3 trung thực).

## 5. Test — lệnh chính xác + PASS thật

Lệnh (chạy trong `service/`):

```
node --import tsx --test "tests/diagnostics-*.test.ts"
```

Output thật:

```
✔ execution-metadata record: exported JSON contains the secret VALUE 0 times (1.4956ms)
✔ diagnostics bundle: exported JSON contains the secret VALUE 0 times (bundle AND execution) (1.833ms)
✔ compose reports status/versions truthfully and never fabricates them (0.1604ms)
✔ an Error carrying a secret value is scrubbed before emit (0.6648ms)
✔ a thrown string and an unknown throwable are handled without leaking a stack (0.1382ms)
✔ redactMessageForEmit scrubs a plain boundary message string (0.0895ms)
✔ scrubs the secret VALUE embedded as a substring of a larger string (0.7484ms)
✔ the env-var NAME alone is NOT the trigger — only the VALUE is (value vs name) (0.1542ms)
✔ unrelated strings pass through unchanged; too-short secrets are ignored (safety) (0.1116ms)
✔ scrubDeep redacts secret values nested in objects and arrays (0.1611ms)
✔ MEDIUM-1 — a secret with JSON-escapable chars in a status field is redacted to 0 real hits
✔ LOW-1 — scrubDeep preserves AND scrubs Error message/stack (non-enumerable)
✔ MEDIUM-2 — scrubJson does NOT throw on a circular graph and still redacts
✔ MEDIUM-2 — logging a circular-reference field does not throw and still redacts
✔ SD3 — verbose is OFF by default and debug is not emitted (0.1539ms)
✔ SD3 — enabling verbose emits debug but does NOT disable redaction (0.1858ms)
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

(16 test sau khi hardening security review — thêm 4 test cho MEDIUM-1/MEDIUM-2/LOW-1/LOW-2.)

Typecheck strict: `npx tsc -b tsconfig.json` → `No errors found` (EXIT 0). Test files cũng typecheck
strict sạch (noEmit, `--strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes`) → EXIT 0.

Mapping test → required test:
- **secret redaction (value-based) unit test** → `diagnostics-scrubber.test.ts` (substring + name-vs-value).
- **error mapping / no-leak test** → `diagnostics-error.test.ts`.
- **export bundle → grep secret → 0 hits (bundle AND execution-metadata)** → `diagnostics-bundle.test.ts`.

## 6. Seam scrub-before-emit cho CGHC-002 error path / CGHC-016 audit

`error-redaction.ts` cung cấp `redactErrorForEmit(scrubber, err)` và `redactMessageForEmit(scrubber, msg)`.
Đóng carry-forward của CGHC-002 ("CGHC-021 redaction PHẢI bọc error path trước khi bất kỳ message
handler nào tới client"): `http-service.ts::fail()` hiện đã fail-safe (message generic cho lỗi ngoài
boundary) — orchestrator khi wire diagnostics vào service chỉ cần bọc `message` bằng
`redactErrorForEmit` trước `writeEnvelope` để cả message boundary-owned (`PayloadTooLargeError`,
`InvalidJsonBodyError`) và detail audit đều được scrub theo VALUE. CGHC-016 audit sink gọi cùng helper
trước khi persist detail. **Không sửa `http-service.ts` ở task này** (ngoài phạm vi thư mục cho phép);
đây là seam sẵn sàng, wiring thuộc orchestrator/CGHC-016.

## 6b. Hardening sau independent security review (PASS_WITH_FINDINGS → 4 finding đã đóng)

Review = PASS_WITH_FINDINGS (0 Crit/High cho key alphanumeric — lõi value-vs-name đã đóng thật). Là
task security-HIGH carried từ L4 nên harden trước khi wire toàn service. Đã fix cả 4:

- **MEDIUM-1 — `scrubJson` stringify-then-scrub bỏ sót secret có ký tự JSON-escapable.** Trước đây
  `JSON.stringify(value)` RỒI mới `scrub()` chuỗi → secret chứa `"`, `\`, newline, control char bị
  escape (`\"`, `\\`, `\n`) nên không còn là substring thô, sống sót ở dạng escaped và
  `countOccurrences(json, rawSecret) === 0` pass giả tạo. **Fix:** `scrubJson` giờ (a) `scrubDeep`
  trước (scrub chuỗi thô TRƯỚC khi escape, đồng thời cycle-safe + giữ Error), rồi (b) `JSON.stringify`
  với **replacer** scrub từng chuỗi trên giá trị chưa-escape (belt-and-suspenders, bắt cả chuỗi do
  `toJSON` sinh ra). Không còn pass "scrub sau escape" thiếu sót. Sửa wording over-claim trong
  `diagnostics-bundle.ts` (module comment + `exportDiagnosticsBundleJson`) cho đúng phạm vi. Test mới
  `MEDIUM-1`: secret `sk-FAKE-"quote\back\nline...` (có `"`, `\`, newline) cắm ở
  `runtimeStatus.host` (field do caller cấp) → positive control khẳng định bundle thô CÓ chứa, sau
  export `countOccurrences === 0` VÀ dạng escaped cũng không sống sót.
- **MEDIUM-2 — `scrubDeep`/`scrubJson` không cycle-safe → throw không bắt có thể crash service loopback.**
  `walk` cũ đệ quy không visited-set; `JSON.stringify` throw trên cycle → `logger.error(msg, fields)`
  với graph vòng (request/socket/error-cause thường gặp) ném `TypeError` ra khỏi `emit` — exception
  chưa xử lý trong path security-critical. **Fix:** thêm `WeakSet` visited-guard trong `walk` (node
  thăm lại → sentinel `"[Circular]"`, vẫn không secret vì đã scrub ở lần đầu); `scrubJson` bọc
  try/catch degrade về placeholder an toàn thay vì throw; `emit` bọc `scrubFields()` try/catch nên
  KHÔNG bao giờ throw do field shape. Test mới: `scrubJson` trên graph vòng không throw + vẫn redact;
  `logger.error` field vòng không throw + vẫn redact.
- **LOW-1 — field Error mất message/stack.** `Object.entries` bỏ qua `message`/`stack` non-enumerable
  của `Error` → `scrubDeep({ err })` ra `{}` (không leak nhưng mất diagnostic). **Fix:** special-case
  `value instanceof Error` trong `walk` → `{ name, message: scrub(message), stack: scrub(stack) }` —
  giữ VÀ scrub. Test mới khẳng định message/stack còn + đã scrub.
- **LOW-2 — bundle test thiếu positive control.** Thêm positive control: input thô (execution record
  và cả status field cho MEDIUM-1) THỰC SỰ chứa value đã cắm trước export, nên `=== 0` sau export
  không thể pass giả tạo.

Tất cả file vẫn < 250 dòng (`secret-scrubber.ts` 166, `redacting-logger.ts` 145, còn lại nhỏ hơn).

## 6c. Wiring gates cho orchestrator / CGHC-016 (ghi nhận — KHÔNG thực hiện ở task này)

Reviewer nêu 3 điều kiện wiring khi diagnostics được nối toàn service (thuộc orchestrator/CGHC-016,
ngoài phạm vi thư mục cho phép của task này):

1. **Register-before-emit ordering:** secret value PHẢI được `scrubber.register(...)` NGAY khi resolve
   ở tầng credential, TRƯỚC bất kỳ log/error/export nào có thể chứa nó. Scrubber chỉ redact value đã
   đăng ký; quên register = leak.
2. **Single shared scrubber instance:** logger, error-path (`redactErrorForEmit`), export bundle, và
   audit PHẢI dùng CHUNG một instance `SecretScrubber`. Nhiều instance rời rạc → một nơi không biết
   secret nơi khác đã đăng ký.
3. **Error-path wrap:** `http-service.ts::fail()` PHẢI bọc `message` bằng `redactErrorForEmit(scrubber, err)`
   trước `writeEnvelope`; audit sink bọc detail trước persist. Seam đã sẵn ở `error-redaction.ts`.

## 7. Giả định

- Secret VALUE được **resolve ở tầng credential (ADR 0006, Windows Credential Manager)** và
  **register vào scrubber ở boundary khi launch/resolve** — module này nhận value đã resolve, không
  truy cập credential store, không hard-code (test cắm secret GIẢ).
- `RuntimeStatus` (SD2) + `VersionInfo` (SD7) do caller cấp từ nguồn sống (supervisor + runtime pin
  `runtimeVersionInfo()` của CGHC-001 + app build info). Module báo cáo đúng đầu vào, không bịa.
- Logs trong bundle giả định đã-redact (đến từ redacting logger); export vẫn chạy pass `scrubJson`
  cuối (defense-in-depth) nên kể cả log chưa-redact từ nguồn khác cũng được scrub khi export.
- `MIN_SECRET_LENGTH = 4`: secret quá ngắn bị bỏ qua (an toàn) — provider key thật dài hơn nhiều.

## 8. Rủi ro / carry-forward

- **R5 (name-only leak)** đã đóng ở tầng scrubber (value-based). Tuy nhiên redaction chỉ mạnh khi
  MỌI secret value được register: orchestrator/CGHC-016 PHẢI register value ngay khi resolve và trước
  bất kỳ log/export nào. Nếu quên register, value sẽ lọt — đây là điều kiện wiring, không phải lỗ hổng
  scrubber.
- **Secret bị biến đổi** (base64/url-encode/split qua nhiều dòng) sẽ KHÔNG khớp substring nguyên bản.
  Trong phạm vi diagnostics/log/env hiện tại secret xuất hiện nguyên văn nên đủ; nếu sau này có kênh
  encode secret, cần thêm biến thể vào register. Ghi nhận cho CGHC-016.
- **Wiring vào boundary** (`http-service.ts::fail()` gọi `redactErrorForEmit`; mount route diagnostics
  export) chưa thực hiện ở đây theo ranh giới task — thuộc orchestrator/CGHC-016. Route export bundle
  nếu mount PHẢI giữ token guard (không `publicUnauthenticated`).
- Chưa gọi provider/binary thật; toàn bộ dùng secret GIẢ (đúng ràng buộc: không dùng key thật, không
  live call).
