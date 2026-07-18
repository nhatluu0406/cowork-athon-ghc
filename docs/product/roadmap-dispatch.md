---
title: "Lộ trình — Dispatch / Fan-out (D1)"
document_type: "roadmap"
language: "vi"
status: "active"
date: "2026-07-18"
updated_at: "2026-07-18"
---

# Lộ trình Dispatch (D1)

Tài liệu này dành cho người đọc muốn nắm **những gì đã có, đang làm, và còn phải làm** với tính năng
Dispatch — không đi vào chi tiết mã nguồn. Nền tảng: trạng thái thật ở
[`current-status.md`](./current-status.md), giới hạn ở
[`../quality/known-limitations.md`](../quality/known-limitations.md), và quyết định kiến trúc ở
[ADR 0011](../architecture/decisions/0011-dispatch-fanout-activation.md).

> **Vị trí hiện tại:** Dispatch đã **chạy thật** (chia nhánh, phiên trợ lý thật, quyền siết ở gốc,
> kết quả trung thực). Việc còn lại chủ yếu là **nghiệm thu trên bản đóng gói**, **bền bỉ hơn** (lưu
> qua khởi động lại) và **an toàn hơn cho kênh điện thoại**.

---

## ✅ Đã có (nền tảng)

- **Trợ lý dựng sẵn** với ba vai (tìm hiểu / thực thi / rà soát); vai chỉ-đọc thật sự không ghi được
  file.
- **Việc dựng sẵn** để bấm chạy ngay.
- **Lệnh gạch chéo** đầy đủ: xem việc, chạy, xem lượt, hủy.
- **Chia nhánh song song** — mặc định 3, tối đa 5; mỗi nhánh là phiên trợ lý thật.
- **Bảng theo dõi trực tiếp** hai cột (ghép nối điện thoại + tiến độ nhánh), chỉ làm mới khi đang
  chạy.
- **Không báo thành công giả** — chỉ công nhận khi có bằng chứng thật trên đĩa.
- **Quyền siết ở gốc** — vai chỉ-đọc cố ghi file bị từ chối tự động, không làm phiền người dùng.
- **Tạo việc từ mô tả bằng lời** (nháp → xác nhận mới lưu).
- **Điều khiển từ điện thoại**: xem trực tiếp, bấm-một-chạm chạy, duyệt/từ chối quyền.

---

## 🔜 ĐANG / SẮP LÀM (ưu tiên gần)

- [ ] **Nghiệm thu bản đóng gói, chạy thật (Checkpoint 5).** Chạy trọn một vòng Dispatch trên bản
  đóng gói với trợ lý AI thật + xác nhận của chủ sản phẩm — để nâng trạng thái từ *PARTIAL* lên
  *WORKS*.
- [ ] **Lưu lượt chạy qua khởi động lại.** Hiện lịch sử lượt chạy và số liệu chỉ tồn tại trong phiên;
  cần lưu lại để mở app không mất.
- [ ] **Chặn cứng kênh điện thoại chưa an toàn.** Chế độ mạng LAN hiện là kết nối chưa mã hoá với mã
  thiết bị dạng thô — cần **từ chối** chế độ này ngoài bản dành cho lập trình viên, và khuyến nghị đi
  qua kênh mã hoá (Tailscale).
- [ ] **Giới hạn số lượt chạy đồng thời từ điện thoại** để tránh bị bấm chạy dồn dập.

---

## 🌤️ SẼ LÀM (trung hạn)

- [ ] **Mã hoá đường truyền cho điện thoại (TLS + ghim chứng chỉ).** Để dùng an toàn cả trên Wi‑Fi
  thường, không chỉ Tailscale.
- [ ] **Lưu mã thiết bị an toàn** (vào kho khoá hệ điều hành) thay vì theo phiên — khỏi phải ghép nối
  lại sau mỗi lần khởi động.
- [ ] **Đo chi phí/độ tốn của việc chia nhánh** để người dùng biết một lượt fan-out "đắt" cỡ nào.
- [ ] **Mỗi nhánh một bản sao thư mục làm việc riêng** để các nhánh không giẫm chân nhau khi cùng sửa
  file.

---

## 🌙 ĐỂ SAU (dài hạn / phụ thuộc bên ngoài)

- [ ] **Xoá/sửa file đáng tin trong lúc chạy nhánh.** Phụ thuộc công cụ của bản trợ lý nền (hiện chưa
  có công cụ xoá ổn định) — chờ nâng cấp có kiểm chứng tương thích.
- [ ] **Lượt chạy theo lịch** (định kỳ) đưa vào sử dụng rộng, kèm quản lý vòng đời.
- [ ] **Bảng điều khiển nâng cao trên điện thoại** (nhiều thao tác hơn ngoài xem / chạy nhanh / duyệt
  quyền), khi kênh đã đủ an toàn.

---

## Cách đọc lộ trình này

- **✅ Đã có** = dùng được ngay hôm nay (mức PARTIAL — xem giới hạn).
- **🔜 Đang/sắp** = việc ưu tiên để đưa Dispatch tới mức tin cậy cho trình diễn/triển lãm.
- **🌤️ Sẽ làm** = cải thiện an toàn và trải nghiệm, không chặn demo.
- **🌙 Để sau** = phụ thuộc nâng cấp bên ngoài hoặc nhu cầu chưa cấp thiết.

*Xem thêm:* câu chuyện demo ở [`user-story-dispatch-demo.md`](./user-story-dispatch-demo.md).
