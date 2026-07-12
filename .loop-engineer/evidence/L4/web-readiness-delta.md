---
title: "Web-readiness delta review (kiến trúc đã freeze)"
document_type: "evidence"
language: "vi"
status: "informational"
---

# Web-readiness delta review — kiến trúc L4 đã đóng băng

> Delta review **giới hạn**, read-only, thực hiện theo chỉ thị product owner khi đặt web =
> `DEFERRED` (xem [ADR 0007](../../../docs/architecture/decisions/0007-web-application-deferral.md)).
> **KHÔNG** chạy lại L4, **KHÔNG** thiết kế lại, **KHÔNG** viết code. Chưa có product/feature code —
> mọi trích dẫn là từ tài liệu kiến trúc đã freeze. Người thực hiện (repository-researcher) độc lập
> với người tạo evidence này (Lead). Ngày: 2026-07-11.

## Kết quả 12 invariant web-readiness

| # | Invariant | Verdict | Trích dẫn (file:line) |
|---|---|---|---|
| 1 | Presentation không gọi trực tiếp Tauri command | HOLDS | `0002-desktop-shell.md:35` (Electron; không có Tauri surface); renderer chỉ có preload bridge + loopback (`cowork-ghc-implementation-design.md:42-43`) |
| 2 | Presentation không gọi trực tiếp Electron IPC | HOLDS | `cowork-ghc-implementation-design.md:242-243` — "no generic IPC passthrough … typed loopback boundary client … narrow typed preload bridge" |
| 3 | Presentation không gọi trực tiếp filesystem API | HOLDS | `cowork-ghc-implementation-design.md:41` — "NO filesystem/credential access, NO provider HTTP" |
| 4 | Presentation không gọi trực tiếp process API | HOLDS | `0002-desktop-shell.md:57` (renderer không có Node/fs/credential access); supervision thuộc App Shell (`0004:44-45`) |
| 5 | Presentation không truy cập trực tiếp credential store | HOLDS | `0006-credential-store.md:83` — "AC3 — key never crosses to the renderer" |
| 6 | Desktop-native capability cô lập sau port/adapter | HOLDS | `0002-desktop-shell.md:56-57` — native capabilities chỉ qua minimal preload bridge |
| 7 | Domain logic độc lập với desktop shell | HOLDS | `0002-desktop-shell.md:68-69` — service/provider/credential "shell-neutral" |
| 8 | Validation schema/contract độc lập transport khi hợp lý | HOLDS | `0005-provider-abstraction.md:36-50` (`ProviderPort` là interface TS thuần); EV schema map ở boundary (`0001:60-64`) |
| 9 | Provider/session/permission/workspace/streaming contract không gắn cứng UI framework | HOLDS | `cowork-ghc-implementation-design.md:91-101` — 5 context nằm trong Local Service, framework-agnostic |
| 10 | UI giao tiếp qua application-client/service boundary rõ ràng | HOLDS | `0003:44-46` — renderer/shell/test là "equal HTTP clients of the same loopback service" |
| 11 | Local application service không phụ thuộc React component | HOLDS | `0003:46-47` — service chạy và test "without Electron" dưới Node `--test`; standalone (`design:80`) |
| 12 | Shared package không import ngược từ desktop-native package | **PARTIAL** | `0002:68-69` bảo đảm *hướng* (shell-neutral) nhưng chưa định nghĩa **package** `core/contracts` tường minh và rule import-direction; `design:195-210` liệt kê `app/shell`, `app/ui`, `service/` nhưng chưa có shared-contract boundary + enforcement |

## Kết luận

**L4 GIỮ `COMPLETED` — chỉ có 1 gap nhỏ (invariant #12).** 11/12 invariant HOLDS với bằng chứng
file:line. Điểm PARTIAL là **thiếu boundary/enforcement tường minh**, không phải vi phạm: thiết kế đã
freeze đã yêu cầu shell-neutral (`0002:68-69`), standalone service (`0003`), credential store
shell-neutral (`0006:29-33`).

**Không đạt bất kỳ điều kiện STALE nào:** không có gì gắn core domain hoặc toàn bộ UI trực tiếp vào
Electron/Tauri; business logic nằm trong standalone loopback service; data ownership/source-of-truth
cố định trong service (`design:91-106`); application-service contract là HTTP+SSE với typed client;
execution/permission boundary là service (`design:45-53`). Component boundary, data ownership, source
of truth, application-service contract, execution boundary — **không cái nào phải đổi**.

## Hành động (targeted, đưa vào L5 — KHÔNG redesign)

- **`web-seam-core-package`** (backlog `CGHC-ARCH-001`, plan trong L5): định nghĩa package
  `core/contracts` shell-neutral tường minh (shared EV, provider, permission, workspace, session,
  `CredentialRef`/`ModelRef`) + rule import-direction có kiểm tra (lint/boundary) để `app/ui` và web
  surface tương lai dùng core mà không import `app/shell` (Electron). Phạm vi: chỉ định nghĩa
  boundary, không redesign, không build web.

## Một câu cho product owner

Kiến trúc desktop đã freeze **đã sẵn sàng cho việc tái sử dụng bởi web**: toàn bộ domain và core
contract nằm trong một standalone loopback service shell-neutral mà UI tiêu thụ thuần túy như HTTP+SSE
client (`0003:44-46`, `0002:68-69`); một web surface tương lai có thể tái sử dụng core mà không đổi
component boundary, data ownership, source of truth, application-service contract hay execution
boundary — chỉ còn task nhỏ ở L5 để hiện thực hóa ranh giới shared-contracts và hướng import.
