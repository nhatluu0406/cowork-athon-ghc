---
title: "CGHC-011 — Add credential + test connection (SSRF F2/F3 hardened) — bằng chứng"
document_type: "implementation-evidence"
language: "vi"
task: "CGHC-011"
loop: "L6"
requirement: "PR2 / PR3"
adr: "0005 / 0006"
---

# CGHC-011 — Add credential + test connection

## Bối cảnh thực thi

Owner subagent (`runtime-llm-engineer`) viết xong code + test thì gặp **API stream stall** đúng ở
bước cuối ("All green. Let me confirm file sizes…"). Loop Engineer Lead xác minh trên đĩa (138/138
service test PASS, tsc clean), điều phối review độc lập (`security-reviewer` ≠ owner), rồi đóng finding
MEDIUM-1 (test-coverage gap) bằng test bổ sung. Phần UI form add-credential **hoãn** sang UI wave (chưa
có `app/ui`); task này giao đúng phần service-side connector + hai security gate mang từ CGHC-010.

## Đã xây dựng

- `service/src/provider/http-dialer.ts` (106 dòng) — file DUY NHẤT mở socket. Production dialer pin
  socket vào IP đã-validate qua `lookup` tùy biến (không bao giờ để Node re-resolve DNS ở connect
  time), giữ SNI + `Host` = hostname gốc, KHÔNG auto-follow redirect (trả 3xx nguyên trạng), bound
  timeout (`ProbeTimeoutError`, không retry). Báo lại `dialedIp = socket.remoteAddress` cho F2.
- `service/src/provider/http-connector.ts` (179 dòng) — `ProviderConnector` thật cho `testConnection`:
  resolve credential muộn qua `resolveInjection` (điểm DUY NHẤT key rời store, đăng ký scrubber), nhét
  key CHỈ vào Authorization header, map kết quả → `TestResult` (2xx ok; 401/403 auth_invalid; timeout
  PR7). Enforce **F2** (assert `dialedIp === pin.address` + thuộc tập validated → `SocketPinViolationError`)
  và **F3** (mỗi 3xx: re-chạy `ssrf.assertAllowed` trên Location trước khi follow; bound hops; cross-host
  → `CrossHostRedirectError`, không gửi lại credential). Streaming qua OpenCode là carry-forward riêng.
- `service/src/provider/probe-profiles.ts` — probe URL + auth header theo provider (Google dùng
  `x-goog-api-key`, không nhét key vào query). `index.ts` export các symbol trên.

## Acceptance → nơi thỏa mãn

1. **Add credential, không echo:** value chỉ từ `resolveInjection`, chỉ vào header; test no-echo chứng
   minh không lộ ra return/log/error (cả success lẫn 401).
2. **Test connection (PR3):** probe thật (fake-inject trong suite) trả success/mapped-error.
3. **F2 (HIGH):** socket-IP pin qua `lookup` + assert `dialedIp === pin` (`http-connector.ts:127-130`).
4. **F3:** re-validate mỗi redirect hop (`http-connector.ts:150`); cross-host không resend credential.

## Test — lệnh + kết quả thật

```
node --import tsx --test "service/**/*.test.ts"   # tests 138  pass 138  fail 0
npx tsc -b                                          # No errors found (exit 0)
```

`service/tests/provider-http-connector.test.ts` (14 test): contract 2xx/401/403/no-cred; no-echo
success+error + scrubber-registered; **F2** public-policy→private-socket REFUSED (+ control pass);
**F3** 302→metadata & 301→RFC-1918 refused (dialer gọi đúng 1 lần); **M1** 302→host công khai KHÁC bị
`CrossHostRedirectError`, credential KHÔNG resend (dialer gọi 1 lần); bounded-hops (không follow vô
hạn); 3xx thiếu Location → mapped error không crash; timeout PR7 không retry; transport ECONNREFUSED
không lộ secret. Không có live network trong default suite (mọi test inject fake `HttpDialer` +
`DnsResolver`).

## Review độc lập (security-reviewer ≠ owner) + xử lý

**PASS_WITH_FINDINGS, 0 Critical/High.** Cả F2/F3 đúng; F2 có test đối kháng; secret discipline giữ
end-to-end (single-source `resolveInjection`, scrubber-registered, header-only, không echo).
- **MEDIUM-1 (ĐÃ ĐÓNG):** nhánh cross-host-non-resend (`CrossHostRedirectError`) trước đó chưa có test →
  thêm test M1 (redirect tới host công khai khác → refuse, dialer 1 lần) + bounded-hops (508) +
  missing-Location (502). 138/138 PASS.
- **LOW-2 (chấp nhận):** real socket path (`createHttpsDialer`) không chạy trong suite — đúng theo policy
  no-live-network; sẽ được phủ khi live-run DeepSeek (CGHC-024) chạy dialer thật qua loopback/test-mode.
- **LOW-3 (chấp nhận, fail-safe):** so IP normalize bất đối xứng (dialedIp đã normalize vs pin chưa) →
  chỉ có thể OVER-block (từ chối nhầm), KHÔNG phải bypass bảo mật; ghi nhận, không nới lỏng.
- **LOW-4 (carry-forward → router/streaming):** `SocketPinViolationError`/`CrossHostRedirectError`/
  `SsrfBlockedError` ném ra ngoài `testConnection`; message không chứa secret (chỉ IP/host), nhưng wire
  handler ở router phải catch + scrub trước khi tới UI → gate cho task wiring router (CGHC-020/UI).

## Carry-forward

- **Streaming SSRF:** OpenCode re-resolve DNS ở socket riêng của nó → hardening socket streaming là task
  streaming (CGHC-014), không phải probe này. Cân nhắc proxy loopback hoặc pass IP đã-pin cho child.
- **LOW-4:** router `testConnection` phải map/scrub các error security trên (không raw stack tới UI).
