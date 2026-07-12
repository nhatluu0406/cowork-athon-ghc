---
title: "Build & workspace toolchain cho L6 (npm workspaces + TypeScript strict + node:test/tsx)"
document_type: "architecture-decision-record"
language: "vi"
status: "accepted"
---

# ADR 0008 — Build & workspace toolchain

- Status: **Accepted** — ghi nhận ngày 2026-07-11 khi mở Loop L6 (Implementation). ADR này **bổ
  sung** (additive): nó chọn công cụ build/test cho phần source mới, **không** thay đổi bất kỳ
  quyết định đã freeze nào của L4 (ADR 0001–0006). Kiến trúc đã freeze giữ nguyên `COMPLETED`.
- Liên quan: ADR 0002 (shell = Electron), ADR 0001 (runtime = OpenCode), ADR 0003 (local service
  standalone Node), ADR 0006 (`@napi-rs/keyring`).

## Bối cảnh

L6 bắt đầu từ greenfield: repo chỉ có controller `tools/loop-engineer/` (zero-dependency) và
`docs/`. Component map (design §9) chia source thành nhiều package: `core/contracts`, `service/`,
`runtime/`, `app/shell`, `app/ui`. Cần một layout monorepo + toolchain build/test **nhẹ, chuẩn,
ít rủi ro**, cho phép nhiều subagent làm việc trên các subtree tách rời mà không đụng nhau, và
phải chạy được trên Windows 11.

## Quyết định

1. **Package manager & layout:** dùng **npm workspaces** (npm đã có sẵn, không thêm công cụ mới).
   Root `package.json` khai báo workspaces `core/*`, `service`, `runtime`, `app/*`. Mỗi workspace
   có `package.json` + `tsconfig.json` riêng, kế thừa `tsconfig.base.json`.
2. **Ngôn ngữ & type safety:** **TypeScript strict** (`strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`). Module `NodeNext`,
   target `ES2022`. Không dùng `any` để né lỗi (coding rules).
3. **Test runner:** **`node --test` (node:test) chạy qua `tsx`** (`node --import tsx --test`). Không
   thêm framework test nặng cho tầng service/runtime/core. Lựa chọn này đồng nhất với controller
   hiện dùng `node --test`. Contract/integration test chạy trên **captured-real-frame fixtures**
   (ADR 0001 pin gate, design §11) — CGHC-024 sở hữu harness đó.
4. **Runtime app service:** chạy TypeScript trực tiếp bằng `tsx` khi dev; build sang JS bằng `tsc`
   khi đóng gói. Service là **standalone Node** (ADR 0003), không phụ thuộc Electron.
5. **Shell/UI (Electron + React):** chỉ vào cuộc ở các task UI/shell (VS-06/…/VS-12). Bundler cho
   renderer và **`electron-builder`** cho packaging được chốt ở task đóng gói (CGHC-028) như một
   ADR/ghi chú bổ sung nếu cần; **không** kéo Electron vào các task tầng service/runtime/core.
6. **Boundary import rule (CGHC-003):** `app/ui` và web tương lai chỉ import `core/contracts`,
   **không bao giờ** import `app/shell` (Electron). Rule này được lint/kiểm tra ở CGHC-003.

## Lý do

- npm workspaces: 0 công cụ mới, hỗ trợ Windows tốt, đủ cho một monorepo POC.
- `node:test` + `tsx`: zero-config, nhanh, không khoá vào một framework; hợp với `.claude/rules/testing.md`.
- Tách Electron khỏi tầng service/runtime giữ **service là standalone Node** (ADR 0003) và cho phép
  test tầng lõi mà không cần môi trường Electron — cũng củng cố shell-neutrality (ADR 0002:68-69,
  CGHC-003).

## Hệ quả

- Mỗi workspace tự khai báo dependency; native module `@napi-rs/keyring` chỉ thuộc `service`
  (credential) — không kéo vào core/runtime.
- Packaging (installer, smoke test trên packaged build) là bằng chứng release ở CGHC-028; **dev
  server không phải bằng chứng release cuối cùng**.
- Nếu sau này cần đổi bundler/packager, chỉ cần một ADR bổ sung ở task đóng gói; quyết định này
  không khoá tầng lõi.

## Trạng thái thay thế

Chưa có. Thay thế ADR này cần một ADR kế nhiệm (superseding), theo quy tắc freeze của L4.
