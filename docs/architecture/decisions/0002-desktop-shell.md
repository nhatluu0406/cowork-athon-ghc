---
title: "Desktop Shell: Electron"
document_type: "architecture-decision-record"
language: "vi"
status: "accepted"
---

# ADR 0002 — Desktop Shell: Electron

- Status: **Accepted** — FROZEN in Loop L4 (Architecture Review), 2026-07-11. Được phê duyệt sau đợt critique đa vai trò + threat model. Thay thế bản nháp Proposed của L3.
- Date: 2026-07-11
- Loop: L3 (Architecture Candidates)
- Deciders: product-architect (L3); sẽ được phê duyệt bởi đợt critique + freeze ở L4. **Đây là
  quyết định sát sao nhất trong L3 — người dùng hoặc L4 có thể override.**
- Requirement drivers: W1 (native picker), S6/SD2 (runtime status), P7 (loopback), SD7 (version),
  LC1–LC5 (Windows lifecycle scripts), tray + auto-update (native capabilities).
- Related ADRs: 0003 (transport/placement), 0004 (lifecycle), 0006 (credential store).

## Context

L2 (`.loop-engineer/evidence/L2/desktop-shell-and-lifecycle.md` §1–2; discovery-report §3.2) đã
chấm điểm Electron so với Tauri cho một **sản phẩm local chỉ chạy trên Windows 11**. Các phát hiện
chính:

- "Tauri README cũ" của reference thực chất là một **cuộc migration Tauri→Electron đã hoàn tất**:
  `electron-builder.yml:1-3,37-39` giữ lại các alias appId/feed Tauri cũ "during the migration
  window." Sản phẩm tương đương gần nhất đã ship cả hai và chọn Electron (lý do không được ghi
  in-tree; nhiều khả năng là các Node-native dep `node-pty`, `better-sqlite3`). Đây là một data
  point, không phải một mandate.
- Trên một target chỉ-Windows-11, các lợi thế cổ điển của Tauri hẹp lại: WebView2 đã cài sẵn, và
  single-WebView loại bỏ sự bất nhất cross-platform. Đánh đổi thực trở thành:
  - **Electron** thắng ở tính đồng nhất stack Node/TS, khả năng test với harness Node `--test` sẵn
    có (reference unit-test logic main-process trực tiếp — `runtime.test.mjs`, `updater.test.mjs`),
    độ trưởng thành hệ sinh thái, và `electron-updater` + NSIS đã được thử lửa.
  - **Tauri** thắng ở bundle size / idle RAM / cold start và một security posture default-deny, với
    cái giá là một native layer + toolchain **Rust** và một vấn đề sidecar orphan-cleanup đã được
    ghi nhận (GH #5611, disc #3273).
- **Không có MUST nào ép buộc lựa chọn**: W1, S6, P7, SD2, SD7, LC1–LC5 đều thỏa mãn được bởi cả
  hai shell (`desktop-shell-and-lifecycle.md` §6).

## Decision

**Adopt Electron as the Cowork GHC desktop shell.** Lý do, được cân nhắc cho *dự án này*:

1. **Đồng nhất stack + khả năng test.** Toolchain hiện có (loop-engineer controller,
   `lifecycle.mjs`, local service dự kiến) là Node/TS và được test với harness Node `--test`.
   Electron giữ một ngôn ngữ/toolchain end-to-end và làm cho logic main-process supervision +
   native bridge có thể unit-test đúng như reference làm (`desktop-shell-and-lifecycle.md` §2 dòng
   Testability, §6). Tauri sẽ chèn một Rust build layer và một toolchain thứ hai (`cargo test`) cho
   công việc native/supervision tùy chỉnh.
2. **Packaging + auto-update đã được chứng minh.** `electron-updater` + NSIS đã được chứng minh
   end-to-end trong reference (`updater.mjs`, `electron-builder.yml:93-109`) và tái sử dụng được;
   NSIS cài per-user hỗ trợ yêu cầu no-admin (ADR 0004).
3. **Native deps.** Các native module cỡ `node-pty` / `better-sqlite3` (nhiều khả năng cần cho
   PTY/local state) là first-class dưới Electron; dưới Tauri chúng cần bản Rust tương đương hoặc
   một Node sidecar (`desktop-shell-and-lifecycle.md` §5 Q1).
4. **Landing point.** Nó khớp với điểm hạ cánh hậu-Tauri của sản phẩm tương đương gần nhất.

Shell chỉ sở hữu **các native capability**: native folder picker (W1, qua `dialog.showOpenDialog`,
phản chiếu reference `main.mjs:1494` — pattern, không phải code copy), system tray (mới; không có
tiền lệ trong reference, `desktop-shell-and-lifecycle.md` §1.3), auto-update, và supervision của
local service process (ADR 0004). Business logic nằm phía sau local service, không nằm trong shell
hay renderer (architecture invariant). Electron `contextIsolation` được bật và renderer không có
truy cập trực tiếp Node/filesystem/credential; nó chỉ với tới các native capability qua một preload
bridge tối thiểu và chỉ với tới business logic qua loopback service.

## Consequences

- Positive: một stack Node/TS duy nhất; các pattern update/packaging/testing đã được reference
  chứng minh có thể tái sử dụng; native module đơn giản.
- Negative: bundle lớn hơn (~80–150 MB) và idle RAM cao hơn (~150–300 MB) so với Tauri; đợt khóa
  bảo mật đầy đủ của Electron là một checklist opt-in chứ không phải default-deny — được giảm thiểu
  bởi contextIsolation-on, một preload surface tối thiểu, và thực tế rằng boundary enforcement thực
  sự của Cowork GHC là local service, không phải shell.
- **Reversibility / điều kiện xem lại:** local service, provider port, và credential store được cố
  ý làm **shell-neutral** (ADR 0003 standalone service; ADR 0006 `@napi-rs/keyring`). Nếu **bundle
  size, idle RAM/cold-start, hoặc default-deny security trở thành mục tiêu sản phẩm bậc nhất**,
  Cowork GHC có thể xem lại Tauri với các lớp service/credential/provider gần như còn nguyên; bề mặt
  gắn-shell phải làm lại sẽ là preload bridge, tray, auto-update, và phần glue Windows supervision.

## Alternatives considered

- **Tauri v2** — được cân nhắc nghiêm túc và hợp lý; là lựa chọn *mạnh hơn* nếu footprint/security
  là bậc nhất. Bị bác ở đây vì đồng nhất stack + khả năng test + update/packaging đã chứng minh +
  native deps, và vì không MUST nào ép nó. Điều kiện xem lại đã nêu ở trên.
- **Wails / Neutralino / raw WebView2 host** — bị bác: sai stack (Go), non-trưởng thành, hoặc mất
  các tiện ích packaging/auto-update/picker (`desktop-shell-and-lifecycle.md` §2 "Other options").

## Requirements traceability

| Requirement | How this ADR satisfies it |
|---|---|
| W1 | Native folder picker via Electron `dialog` in the shell, exposed through the preload bridge. |
| S6/SD2 | Runtime status rendered from the loopback service's health/state; shell shows tray + window state. |
| P7 | Shell does not weaken loopback; the service binds loopback only (ADR 0003). |
| SD7 | Shell reports app + runtime version. |
| LC1–LC5 | Shell is supervised by the Node lifecycle CLI; NSIS per-user install, no admin (ADR 0004). |

## Open items for L4

- Trọng số quyết định (đồng nhất stack vs footprint/security) — xác nhận hoặc override.
- Phạm vi POC cho tray + auto-update (tray không có tiền lệ trong reference; xác nhận trong scope
  hay hoãn).
- Xác nhận cách diễn đạt điều kiện xem lại là một trigger thực, có thể kiểm chứng, chấp nhận được.
