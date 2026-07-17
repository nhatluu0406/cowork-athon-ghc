# Idea log

## 2026-07-14

- Original prompt (verbatim):
  > đọc src code hiện tại, tìm status đã build và xem thử mục agents harness inner loop đã build chưa, khi nhận endpoint llm vào thì nó có đủ các tác nhân harness chưa, tham khảo @AGENT-HARNESS.md

- Original prompt (verbatim):
  > mục tiêu là có 1 cổng pwa để control trên điện thoại tới cowork app này, như dispatch của code. Có sẵn các built-in loop, built-in skills, built-in agents fan out loop and tasks definition, bổ sung thành plan vào trong agent-harness-plan.md để ra các step cần build tiếp theo là gì

- Notes / constraints:
  - Baseline: Cowork GHC packaged Windows desktop POC `poc-v0.1`; inner loop ủy quyền cho OpenCode runtime (child process); service tự viết là lớp harness.
  - Kết quả audit harness: single-agent loop + file tools + skills + permission gate + streaming + persistence ĐÃ có; multi-agent (D1), semantic memory/RAG (D3), LLM gateway (D4), reflection/eval, MCP live, LLM Ops CHƯA có.
  - ADR 0003 (loopback-only) và ADR 0007 (web deferral) đang chặn remote/PWA surface — plan đặt Phase 0 làm gate ADR.
  - Kế hoạch chi tiết: `agent-harness-plan.md` (repo root) — 7 phase: ADR/contracts → control API loopback → pairing/remote gateway → PWA → task definitions/loops → built-in agents/fan-out (D1) → hardening.
  - Exit criterion hiện tại của product (packaged permission golden path) vẫn `BLOCKED — PACKAGED CHECK REQUIRED`; remote permission xây trên nền này.

- Open questions:
  - ~~Transport v1: tunnel-first (Tailscale/VPN) hay LAN listener + TLS ngay từ đầu?~~ → đã chốt bên dưới (2026-07-14, clarification 2)
  - Scope remote v1: monitor + permission reply + send prompt (khuyến nghị) hay thêm CRUD TaskDefinition từ phone?
  - Giới hạn fan-out mặc định ≤ 3 session con có phù hợp quota DeepSeek hiện tại?
  - Web Push có bắt buộc trong v1 không (hay SSE khi app mở / Discord notification là đủ)?
  - Discord có được `approve` hành động ghi file không, hay chỉ notify + deny + send prompt?
  - Discord bind qua DM với bot hay private guild/channel riêng?

### Clarification 2 (2026-07-14)

- Original prompt (verbatim):
  > có, thế option điều khiển qua discord như pattern C nhé, có cả pattern B điềuk hiển qua tailscale như 1 option fallback cũng tốt, web socket https pair bằng 1 lần scan QR trên LAN cũng tốt. Tạo cả 3 option trên như 1 feature remote nhé. Có thể bật bằng cách gọi /remote

- Notes / constraints:
  - PO chốt: remote là MỘT feature với 3 channel — `lan-qr` (WebSocket over HTTPS trên LAN, pair 1 lần scan QR) primary; `tunnel` (Tailscale/VPN) fallback; `discord` (bot notification + reply-to-prompt + approve/deny).
  - Kích hoạt bằng lệnh `/remote` trong composer (AD-8 trong `agent-harness-plan.md`); `/remote off` revoke.
  - Nguồn tham khảo đã khảo sát trên GitHub 2026-07-14: official Claude Code Remote Control (outbound-only, Trusted Devices, `--spawn worktree`), slopus/happy (E2E relay), siteboon/claudecodeui, buckle42/claude-code-remote (Tailscale+ttyd), TheKinng96/claude-remote (QR LAN), JessyTsui/Claude-Code-Remote (Discord/email), omnara-ai/omnara (`requires_user_input`).
  - Plan đã cập nhật: AD-2/AD-3/AD-8, Task 0.2, Phase 2 (2.1–2.4, thêm Discord adapter + `/remote`), Task 5.2 (option git worktree per session con), risks + open questions mới.

### Clarification 3 (2026-07-14) — PO chốt toàn bộ open questions vòng 1

- Q5 (approved verbatim: "Oke, q5 approved"): Discord v1 chỉ notify + `deny` + send prompt; `approve` hành động ghi file bắt buộc từ PWA/desktop, enforce ở service.
- Q2 (answer verbatim): "1 và 2, kiểu 2 nên có sẵn các template hoặc schedule cũ có thể 1 touch reuse và custom bằng prompt miêu tả workflow để tự build agents workflow & task" → scope v1 = monitor + prompt + permission + trigger task có sẵn từ phone; template/schedule 1-touch reuse (Task 4.1); workflow builder từ prompt, draft phải confirm mới lưu, không auto-run (Task 4.3 + 3.4).
- Q3: fan-out mặc định 3, `maxConcurrency` per task, trần cứng 5 ở service (Task 5.2).
- Q4: KHÔNG cần Web Push v1 — SSE khi app mở + Discord notification khi rời app.
- Q6: Discord bind qua private guild + thread (1 channel per workspace, 1 thread per conversation/task) (Task 2.3).
- Phase 0 hết bị chặn bởi quyết định sản phẩm.
