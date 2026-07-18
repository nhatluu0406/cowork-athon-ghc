---
title: "Danh sách chức năng để demo — Cowork GHC"
document_type: "demo-guide"
language: "vi"
status: "accepted"
date: "2026-07-18"
updated_at: "2026-07-18"
---

# Danh sách chức năng để demo

Tài liệu này viết cho người demo, ngôn ngữ đời thường: **mỗi chức năng làm gì** và **cách test nhanh**.
Không đi vào chi tiết kỹ thuật.

> **Cowork GHC** là ứng dụng desktop (Windows) để làm việc cùng một trợ lý AI ngay trên máy: kết nối
> AI của bạn, chọn thư mục làm việc, chat và cùng xử lý file — mọi thứ chạy nội bộ, có kiểm soát quyền.

---

## 1. Các chức năng chính

| # | Chức năng | Làm gì (nói đơn giản) | Cách test nhanh |
|---|---|---|---|
| 1 | **Kết nối AI** | Nhập địa chỉ + khoá của một dịch vụ AI (kiểu OpenAI) và chọn model. | Vào **Cài đặt → Nhà cung cấp** → nhập Base URL + Khoá → bấm **"Dò model"** → chọn model → lưu. Thấy chấm xanh "đã kết nối". |
| 2 | **Chat với trợ lý** | Nhắn yêu cầu, trợ lý trả lời theo thời gian thực, nhớ ngữ cảnh. | Ở màn **Cowork**, gõ một câu hỏi → Enter → xem trả lời hiện dần. |
| 3 | **Chọn & xem/sửa file** | Mở một thư mục làm việc, xem và sửa file văn bản/code, xem PDF/Word/Excel. | Chọn workspace → mở một file text → sửa → lưu. Gõ **@** trong ô chat để chèn nhanh đường dẫn file. |
| 4 | **Kỹ năng & MCP (Skills)** | Bật/tắt các "kỹ năng" (hướng dẫn cho trợ lý) và kết nối công cụ ngoài (MCP). | Vào rail **Kỹ năng & MCP** → bật một skill → thấy chip "Kỹ năng" hiện trên tin nhắn khi dùng. |
| 5 | **Kiểm soát quyền** | Chọn trợ lý được làm gì: **Hỏi trước / Tự động trong workspace / Chỉ đọc**. | Đổi chế độ ở thanh soạn → yêu cầu trợ lý sửa file → xem nó **hỏi xin phép** trước khi ghi. |
| 6 | **Dispatch (chạy workflow)** | Bấm nút để chạy một **workflow** — nhiều trợ lý chạy song song, theo dõi tiến độ. | Vào màn **Dispatch** → bấm **"Chạy"** trên một workflow → xem các nhánh chạy trên bảng. *(Xem mục 2 & 3.)* |
| 7 | **Kết nối điện thoại** | Ghép nối điện thoại (cùng Wi‑Fi/Tailscale) để **theo dõi** và **duyệt quyền** từ xa. | Màn **Dispatch** hiện mã **QR** → quét bằng điện thoại → đặt tên thiết bị → kết nối. *(Xem mục 2.)* |

---

## 2. Kịch bản demo **ưu tiên** — kết nối điện thoại + duyệt quyền

Đây là điểm nhấn nên demo trước:

1. **Trên máy tính:** mở app → mở khoá → chọn provider (mục 1) + workspace.
2. Vào màn **Dispatch** → thấy **mã QR** ở cột trái ("Truy cập nhanh bằng điện thoại").
3. **Trên điện thoại** (cùng Wi‑Fi hoặc Tailscale): quét QR → nhập mã ghép nối → đặt tên → **Kết nối**.
4. Trên điện thoại giờ **theo dõi được** phiên đang chạy.
5. **Bấm chạy một workflow** (đã tạo sẵn ở máy — xem mục 3) ngay **từ điện thoại** (1 chạm).
6. Khi workflow có bước cần xin phép, **thông báo duyệt quyền hiện trên điện thoại** → bấm **Cho phép / Từ chối** ngay trên điện thoại. Từ chối là **chặn thật** ở máy tính.

> Thông điệp demo: "Rời bàn làm việc vẫn theo dõi và **duyệt quyền từ điện thoại** được; workflow chạy
> thật trên máy, điện thoại chỉ điều khiển."

---

## 3. Dispatch — cách hoạt động **trong demo hiện tại**

- **Cách dùng:** ở màn **Dispatch** desktop có **cột "Tạo workflow mẫu"** (bên phải): gõ một mô tả →
  hệ thống soạn sẵn một workflow → xem lại → **Lưu**. Workflow đã lưu xuất hiện trong bảng.
- **Chạy:** bấm nút **"Chạy"** trên workflow — trên máy tính hoặc **1 chạm trên điện thoại**.
- **Quan trọng — giới hạn có chủ đích của bản demo:** Dispatch hiện **chỉ bấm nút để chạy các workflow
  (đã tạo sẵn / mẫu)**, **chưa chat trực tiếp** vào Dispatch được. Cách demo đúng là: **tạo sẵn vài
  workflow mẫu trên máy tính**, rồi **bấm chạy từ điện thoại** và **duyệt quyền trên điện thoại**.
- **Chưa có trong bản này (đã đưa vào roadmap phase sau):** chat trực tiếp kiểu "gõ một câu trên điện
  thoại → máy tính tự brainstorm, tự tạo task và trả lời" (giống Claude dispatch). Xem
  [`roadmap-dispatch.md`](./roadmap-dispatch.md).

---

## 4. Chuẩn bị trước khi demo (checklist nhanh)

- [ ] Provider đã kết nối (mục 1), model đã chọn.
- [ ] Đã chọn một workspace nhỏ có sẵn vài file.
- [ ] Đã **tạo sẵn 1–2 workflow mẫu** ở cột phải màn Dispatch (để bấm chạy khi demo).
- [ ] Điện thoại cùng Wi‑Fi (hoặc Tailscale) với máy tính, đã cài sẵn để quét QR.
- [ ] (Nếu dùng LLM chạy nội bộ qua `http`) đã bật dev-skip — xem
  [`walkthrough-dispatch-d1.md`](./walkthrough-dispatch-d1.md).

---

## 5. Những điều cần nói thật khi demo (đừng giấu)

- Dispatch **chạy thật** (nhiều trợ lý song song, quyền siết thật, không báo "xong" giả) nhưng **chưa
  chat trực tiếp** — chỉ bấm nút workflow.
- Kết nối điện thoại ở chế độ Wi‑Fi thường **chưa mã hoá** — nên demo qua **Tailscale** hoặc mạng tin cậy.
- Sau khi khởi động lại app, cần **ghép nối điện thoại lại**.
- Kết quả chi tiết (nội dung trợ lý viết ra) hiện **chưa hiển thị đầy đủ trong bảng** — đang trong
  roadmap.

---

*Tài liệu liên quan:* [`user-story-dispatch-demo.md`](./user-story-dispatch-demo.md) (câu chuyện demo
Dispatch) · [`walkthrough-dispatch-d1.md`](./walkthrough-dispatch-d1.md) (khởi động chi tiết) ·
[`roadmap-dispatch.md`](./roadmap-dispatch.md) (lộ trình).
