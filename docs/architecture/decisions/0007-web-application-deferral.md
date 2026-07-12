---
title: "Hoãn phát triển Next.js / web application (DEFERRED)"
document_type: "architecture-decision-record"
language: "vi"
status: "accepted"
---

# ADR 0007 — Hoãn phát triển Next.js / web application

- Status: **Accepted** — ghi nhận ngày 2026-07-11 theo chỉ thị product owner. ADR này **bổ sung**
  (additive), **không** thay đổi bất kỳ quyết định đã đóng băng nào của L4 (ADR 0001–0006). Vì vậy
  kiến trúc đã freeze vẫn giữ nguyên trạng thái `COMPLETED`.
- Liên quan: `CGHC-WEB-001` (backlog), cổng quyết định tương lai ở L10.

## Bối cảnh

Mục tiêu phát hành hiện tại của Cowork GHC là **ứng dụng desktop cho Windows 11 local PC**
(`local-first`, `packaged application`, `runtime` + `workspace` ổn định, trải nghiệm người dùng
hoàn chỉnh). Product owner xác nhận: trong phạm vi POC đang hoạt động, **không** phát triển
Next.js hoặc bất kỳ web application nào. Web chỉ là **một khả năng sản phẩm cần đánh giá sau**,
không phải deliverable mặc định.

## Quyết định

Toàn bộ việc phát triển Next.js / web application được đặt ở trạng thái **`DEFERRED`**.

Trong giai đoạn hiện tại, KHÔNG được:

- Tạo active implementation loop cho web.
- Tạo `apps/web` chỉ để giữ chỗ.
- Cài đặt Next.js.
- Xây `authentication`, `cloud backend`, hoặc `deployment` dành riêng cho web.
- Xây `local companion service` chỉ để chứng minh web có thể hoạt động.
- Mở rộng test matrix để kiểm thử một web client chưa được phê duyệt.
- Làm chậm desktop POC vì `feature parity` với web.
- Giả định Cowork GHC chắc chắn cần một web app đầy đủ trong tương lai.

Mục tiêu hiện tại vẫn là:

```text
Cowork GHC Windows Desktop POC
→ local-first
→ packaged application
→ runtime và workspace hoạt động ổn định
→ trải nghiệm người dùng hoàn chỉnh
```

## Điều kiện kích hoạt (activation condition)

Web epic `CGHC-WEB-001` **không** được tự động chuyển sang `READY`. Chỉ được kích hoạt khi:

- Desktop POC đạt **L9** với trạng thái `PASS`; **hoặc**
- Product owner chủ động kích hoạt web phase.

## Web-readiness (không phải cam kết xây web)

Kiến trúc desktop đã freeze được yêu cầu giữ **seam sạch** (port/adapter, application-service
boundary, domain logic độc lập với shell) để một web surface trong tương lai *có thể* tái sử dụng
core mà không phải thiết kế lại. Việc kiểm tra các invariant này là **delta review giới hạn**, không
phải chạy lại L4. Bằng chứng: `.loop-engineer/evidence/L4/web-readiness-delta.md`.

## Các khả năng web cần đánh giá sau (không giả định `feature parity` với desktop)

- Không cần web app (`NO_WEB_REQUIRED`).
- `Remote monitoring client`.
- `Remote approval client`.
- `Web administration console`.
- `Microsoft integration portal`.
- `Knowledge portal`.
- `LLM gateway administration console`.
- `Full Cowork GHC web client`.
- Web client kết nối `cloud runtime`.
- Web client kết nối `local companion`.

## Cổng quyết định tương lai (thực hiện ở L10)

Ở **L10**, tạo tài liệu `docs/integrations/nextjs-web-application.md` (tiếng Việt) trả lời 18 câu hỏi
sản phẩm/kỹ thuật và kết luận đúng **một** trong các giá trị (enum, giữ tiếng Anh):
`NO_WEB_REQUIRED` · `WEB_ADMIN_ONLY` · `REMOTE_MONITORING_WEB` · `KNOWLEDGE_PORTAL` ·
`MICROSOFT_INTEGRATION_PORTAL` · `FULL_WEB_CLIENT` · `REQUIRES_MORE_VALIDATION`.
**Không** mặc định chọn `FULL_WEB_CLIENT`.

## Web loops tương lai (chỉ là deferred proposal — KHÔNG thêm vào loop đang hoạt động)

```text
W0 — Web Product Discovery
W1 — Web Scope and Deployment Model
W2 — Shared Package Readiness
W3 — Web Application Shell
W4 — Runtime Connectivity
W5 — Browser and Companion Security
W6 — Web Integration and Release Verification
```

Các loop W0–W6 **không** được thực thi trước activation condition và **không** được làm cho
`/loop-engineer all` tự động chạy web phase.

## Hệ quả (consequences)

- Không tốn chi phí và bề mặt bảo mật mới cho web trong giai đoạn POC.
- Desktop POC không bị phân tán nguồn lực.
- Đổi lại: cần một cổng quyết định riêng ở L10 để tránh mặc định xây web.

## Phương án đã cân nhắc

- **Xây web song song ngay bây giờ** — loại bỏ: làm chậm desktop POC, tạo bề mặt bảo mật chưa cần.
- **Giữ chỗ `apps/web` trống** — loại bỏ: tạo nợ kỹ thuật và ảo giác về cam kết chưa có.
- **Hoãn có điều kiện (đã chọn)** — giữ desktop là trọng tâm, mở đường cho web khi có use case rõ ràng.
