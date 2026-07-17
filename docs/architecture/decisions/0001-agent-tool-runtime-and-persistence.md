---
title: "Agent/Tool Runtime: tái sử dụng OpenCode (pinned, supervised child) + quyền sở hữu persistence"
document_type: "architecture-decision-record"
language: "vi"
status: "accepted"
---

# ADR 0001 — Agent/Tool Runtime: Reuse OpenCode (pinned, supervised child) + Persistence Ownership

- Status: **Accepted** — FROZEN in Loop L4 (Architecture Review), 2026-07-11. Được phê duyệt sau đợt critique đa vai trò + threat model. Thay thế bản nháp Proposed của L3.
- Date: 2026-07-11
- Loop: L3 (Architecture Candidates)
- Deciders: product-architect (L3); sẽ được phê duyệt bởi đợt critique đa vai trò + freeze ở L4.
- Requirement drivers: RE6 (tái sử dụng một runtime), S1–S6, EV1–EV7, P1/P3, F1–F6, SD7.
- Related ADRs: 0003 (transport/placement), 0004 (lifecycle/supervision), 0005 (provider port), 0006 (credential store).

## Context

RE6 bắt buộc tái sử dụng một agent/tool runtime sẵn có trừ khi có ADR biện minh cho việc tự xây
mới. L2 discovery (`.loop-engineer/reports/discovery-report.md` §3.1;
`.loop-engineer/evidence/L2/runtime-candidates.md`) đã đánh giá ba phương án:

- **A — reuse OpenCode** (bản sst/anomalyco TypeScript OpenCode, `opencode serve` HTTP+SSE,
  `@opencode-ai/sdk`, pinned `v1.17.11` tại reference `constants.json:2`). Nó đã phơi bày sẵn
  toàn bộ bề mặt S/EV/P/F: sessions + message store trong SQLite riêng qua `better-sqlite3`
  (`opencode-db.ts:6,54-66`), streaming events + tool-permission qua `/event` SSE và
  `/permission/:id/reply`, reply auth có thể enforce tại boundary (`server.ts:634-654`), và một
  pattern supervise-and-proxy đã được chứng minh (`managed-opencode.ts:58-159`). MIT-licensed,
  native Windows x64/arm64 binary + Scoop/Choco/npm SDK.
- **B — build new.** Nỗ lực nhiều engineer, nhiều tháng để nhân bản một upstream 184k-star /
  835-release, gồm toàn bộ phần plumbing provider/LLM tool-loop. Mâu thuẫn trực tiếp với RE6.
- **C — other runtimes** (Go OpenCode TUI; các provider-coupled agent SDK; Aider/Continue/Cline).
  Mỗi phương án đều yếu hơn ở một local HTTP+SSE session/permission service ổn định, có thể nhúng
  (`runtime-candidates.md` §3).

L2 cũng xác nhận ba residual risk mà ADR này phải xử lý: Windows orphan-reap chỉ có cho Unix trong
reference (`runtime.mjs:1072`), provider key nằm trong auth store riêng của OpenCode (anti-pattern
PR9), và OpenCode là một upstream biến động nhanh (835 releases) đòi hỏi một chính sách pin +
upgrade-test (`runtime-candidates.md` §5).

## Decision

**Reuse OpenCode as a pinned, single-owner, supervised child process** của local application
service của Cowork GHC. Cowork GHC không fork, clone, hay rebrand OpenCode; nó tiêu thụ runtime như
một external dependency và giữ execution/permission boundary riêng của mình ở phía trước.

1. **Version pin + upgrade policy.** OpenCode được pin về một version tường minh duy nhất trong một
   constant do Cowork GHC sở hữu (một single source kiểu `constants.json`, phản chiếu pattern
   `constants.json:2` của reference; **không** copy từ reference). SD7 hiển thị cả version của
   Cowork GHC lẫn version runtime đã pin. Nâng cấp pin là một thay đổi có gate: provider contract
   suite (ADR 0005) + các test map SSE/event-schema (bên dưới) + các lifecycle test (ADR 0004) phải
   pass trên Windows với pin mới trước khi được đưa vào. Không dùng range floating/`^` cho runtime
   binary.

2. **Persistence / source-of-truth split (gộp PA-3).** Một source of truth cho mỗi loại state:
   - **OpenCode sở hữu nội dung session + message** trong SQLite store riêng (`opencode-db.ts:54-66`;
     trên Windows nằm dưới `%APPDATA%`, có thể override qua `OPENCODE_DB`/`XDG_DATA_HOME`). Cowork
     GHC **không** xây một session-content store thứ hai và không mirror phần thân message.
   - **Cowork GHC chỉ sở hữu settings riêng + session metadata nhẹ** (grouping/pin/order, workspace
     registry, model preferences dưới dạng ref *logic*, audit log). Điều này phản chiếu cách chia
     của reference nơi OpenWork chỉ giữ light grouping state (`session-groups.ts`) và proxy các lần
     đọc nội dung (`routes/sessions.ts`), theo `runtime-candidates.md` §1.6.
   - Settings/metadata riêng của Cowork GHC được lưu trong một app-owned local store (cơ chế—file
     hay embedded DB—được chọn ở L5; phải corrupt-tolerant theo SD5). Credentials **không** nằm
     trong store này (ADR 0006). Model ref là logic và không chứa secret (an toàn để lưu; key thì
     không).

3. **Event-schema boundary.** Cowork GHC coi OpenCode SSE event schema như một contract *external*
   và map nó vào một EV event model do Cowork GHC sở hữu tại service boundary, để upstream schema
   churn không rò rỉ vào UI (`runtime-candidates.md` §6, Q6). Bản typed `@opencode-ai/sdk` được dùng
   tại service boundary như wire client (contract layer), không phải HTTP tự viết tay; UI không bao
   giờ nói trực tiếp bằng schema của OpenCode.

4. **Windows supervision do Cowork GHC sở hữu.** Orphan sweep của reference chỉ dành cho Unix
   (`runtime.mjs:1072`) và không được tái sử dụng; supervision an toàn cho Windows + graceful stop
   được đặc tả trong ADR 0004. Runtime được spawn bằng argument array (không nội suy shell string)
   nên các workspace path có khoảng trắng/Unicode đều an toàn (`managed-opencode.ts:91-95`).

5. **`/ee` Fair Source boundary.** `LICENSE` gốc của reference là MIT ngoại trừ `/ee`, vốn là Fair
   Source (`ee/LICENSE`; discovery-report §3.6). Cowork GHC **không bao giờ copy code `/ee`** và
   không phụ thuộc vào nó. Bản thân OpenCode và các direct runtime dep đều permissive (MIT/BSD). Một
   bản scan SPDX transitive tự động được hoãn sang L5 (PA-1 residual) — nó không thể chạy cho tới
   khi tồn tại một `package.json` của Cowork GHC.

## Consequences

- Positive: toàn bộ họ requirement S/EV/P/F thu được từ một upstream trưởng thành; Cowork GHC tập
  trung ngân sách vào boundary của nó (permission enforcement, credential store, Windows lifecycle,
  UI).
- Positive: one source of truth cho mỗi loại state được giữ (không có session-content store trùng
  lặp).
- Negative / phải gánh: Cowork GHC sở hữu Windows orphan-reap + graceful stop (ADR 0004) và
  key-injection seam (ADR 0006) — cả hai đều không tồn tại trong đường reuse. Tốc độ upstream đòi
  hỏi kỷ luật pin liên tục.
- Constraint: Cowork GHC không bao giờ được persist provider key vào `auth.json`/`env.json` của
  OpenCode (SEC-1; enforce trong ADR 0006).

## Alternatives considered

- **Build a new runtime (B)** — bị bác: mâu thuẫn RE6, nhân bản LLM tool-loop, tốn nhiều tháng.
  Chỉ xem lại khi có một blocker reuse cứng (license đổi, Windows supervision không sửa được, hoặc
  một xung đột credential không thể tách seam) — không tìm thấy cái nào trong L2.
- **Other runtimes (C)** — bị bác: bề mặt embeddable local HTTP+SSE session/permission yếu hơn; các
  provider-coupled SDK mâu thuẫn với invariant provider-neutral.
- **Chấp nhận store riêng của OpenCode làm single credential store** — bị bác: không đạt yêu cầu
  OS-backed của PR9 (xem ADR 0006).

## Requirements traceability

| Requirement | How this ADR satisfies it |
|---|---|
| RE6 | Reuse OpenCode, pinned + shown; build-new explicitly rejected with rationale. |
| S1–S6 | Session/message lifecycle + restore provided by OpenCode's store; Cowork GHC owns light metadata. |
| EV1–EV7 | OpenCode `/event` SSE mapped to a Cowork-GHC EV model at the boundary (no fabricated states). |
| P1/P3 | OpenCode tool-permission fronted by the Cowork GHC execution boundary (ADR 0003/0005). |
| F1–F6 | File ops flow through the Cowork GHC boundary in front of the runtime. |
| SD7 | Pinned runtime version surfaced alongside app version. |

## Open items for L4

- Xác nhận giá trị pin chính xác và thành phần của upgrade-test gate.
- Xác nhận bao nhiêu phần của OpenCode SSE schema được re-normalize so với pass-through (Q6).
- Xác nhận dependency `@opencode-ai/sdk` typed so với một thin internal client (đánh đổi coupling).
- Xác nhận cơ chế app-owned metadata store được hoãn sang L5 (ADR này chỉ chốt quyền sở hữu).
