---
language: "vi"
status: "accepted"
date: "2026-07-14"
deciders: ["product-owner", "runtime-llm-engineer"]
related: ["0003-local-service-transport-placement-loopback.md", "0007-web-application-deferral.md"]
---

# ADR 0010 — Remote gateway + PWA control surface (flag-gated)

## Context

Product Owner yêu cầu (2026-07-14, ghi tại `review/idea.md` và `agent-harness-plan.md`) một cổng
điều khiển Cowork từ điện thoại, tương tự Remote Control/Dispatch của Claude Code, với 3 channel:
`lan-qr` (WebSocket/HTTPS trên LAN, pair bằng QR một lần), `tunnel` (Tailscale/VPN, fallback),
`discord` (bot notify + deny + prompt). ADR 0003 khóa main service ở loopback-only; ADR 0007 defer
web application đầy đủ. Cần một quyết định kiến trúc cho remote access mà không phá hai ADR trên.

## Decision

1. **Main service giữ nguyên loopback-only (ADR 0003 không đổi).** Remote access đi qua một
   **remote gateway listener riêng** (`service/src/remote-gateway/`), là reverse proxy có
   **allowlist tường minh** tới main service. Gateway giữ per-launch client token của main service
   ở phía server; token này không bao giờ tới remote client.
2. **Thiết bị remote xác thực bằng device token riêng** phát hành qua pairing code một lần
   (TTL 2 phút, lockout sau 5 lần sai, tối đa 8 thiết bị). Token chỉ lưu dạng SHA-256 digest,
   in-memory per-launch (MVP); persist keyring là slice sau.
3. **Toàn bộ feature OFF mặc định** sau flag `CGHC_REMOTE_ENABLED`. Flag off ⇒ composition
   byte-for-byte không đổi (test `remote-wiring.test.ts` flag-OFF). `CGHC_REMOTE_LAN=1` bind LAN
   cho demo cùng Wi-Fi — **chưa có TLS, là dev/demo flag, không phải default được ship**;
   TLS + cert pinning cho channel `lan-qr` là hardening slice tiếp theo.
4. **PWA là thin control client** (một file HTML tự chứa serve bởi gateway, không Next.js,
   không `apps/web`) — không mâu thuẫn ADR 0007: web application đầy đủ vẫn DEFERRED.
5. MVP gồm **read + permission decision** (list conversations, transcript, live EV stream, và
   Allow/Deny qua POST allowlist duy nhất tới `/v1/permission/decision` — gateway không phải
   authority thứ hai, gate duy nhất vẫn resolve và enforce tại `gate.proceed`). Send prompt,
   channel `discord`, và lệnh `/remote` trong composer là các slice tiếp theo theo
   `agent-harness-plan.md` Phase 1–3.

## Consequences

- (+) Delta bảo mật nhỏ nhất: main boundary không đổi; remote surface tách riêng, tắt mặc định,
  fail-closed từng route; hai trust domain token tách biệt (test chứng minh device token bị main
  service từ chối trực tiếp).
- (+) Reuse một nguồn sự thật: gateway không đẻ session mechanism song song, chỉ proxy các route
  đã có (`/v1/conversations`, `/v1/session/stream`).
- (−) LAN mode chưa mã hóa transport → chỉ demo; phải hoàn thành TLS/pinning trước khi coi
  `lan-qr` là channel sản phẩm.
- (−) Device token mất khi restart (in-memory) → điện thoại pair lại; chấp nhận ở MVP.
- Độc lập security review là bắt buộc trước khi merge slice mở rộng network exposure (theo
  CLAUDE.md); MVP này flag-off-by-default nên baseline không đổi.

## Alternatives considered

- **Relay server ngoài (kiểu Anthropic/Happy)**: outbound-only, đẹp về NAT traversal nhưng cần
  hạ tầng relay + E2E encryption — quá nặng cho MVP local-first.
- **Nới loopback của main service**: bị loại — phá ADR 0003 và mở rộng attack surface của
  execution boundary.
- **ttyd/tmux terminal-as-webpage**: không khớp product (UI hội thoại, không phải terminal).

## Requirements traceability

- `agent-harness-plan.md` AD-2, AD-3, Task 2.1/2.2 (một phần), Checkpoint 1 (một phần).
- Quyết định PO 2026-07-14: 3 channel, `/remote`, Q5 (Discord không approve ghi file).

## Open items

- TLS self-signed + cert fingerprint trong QR (channel `lan-qr` production).
- Persist device registry vào keyring; revoke UI (`/remote` panel — plan Task 2.4).
- Send prompt qua gateway (plan Task 1.2) và channel `discord` (Task 2.3). Permission reply
  (Task 1.3) đã giao cùng ngày.
- QR code render trên desktop thay cho mã gõ tay.
