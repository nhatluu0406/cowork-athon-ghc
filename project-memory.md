
---

## 2026-07-17 21:09 (session b9982c5e-64e9-44a5-8044-a6bdd85f80fb)

Xong. Đã tạo **`docs/design.md`** (mới — trước đây chưa tồn tại) và commit `aafbb1d` (chưa push).

Nội dung được cấu trúc để **sinh trực tiếp HTML và Excalidraw** mà không cần đọc thêm code:

- **§1 Mô hình 6 cột** (clients → renderer → shell → service → data/runtime → external) kèm mã màu cho từng tầng.
- **§2 Danh mục node có ID** — ~40 node với nhãn hiển thị, type (actor/component/store/process/external), đường dẫn code thật, và trạng thái (WORKS / PARTIAL / FLAG-OFF / AWAITING) khớp `current-status.md`. Bao gồm đúng 7 key preload bridge (kể cả `saveTextFile` mới từ main) và 7 surface trong rail.
- **§3 Danh mục edge E01–E26** — from/to theo node ID, nhãn giao thức (IPC, loopback HTTP + Bearer, SSE EV, stdio, HTTPS…), style solid/dashed cho flag.
- **§4 Boundary B1–B6** — renderer sandbox, main process, local trust zone, child runtime, SSRF egress, remote surface — kèm bất biến an ninh của từng khung.
- **§5 Luồng F1–F6** — unlock, chat streaming, permission + File Work Review, dispatch fan-out (D1/ADR 0011), remote pairing, diagnostics — mỗi bước tham chiếu đúng edge ID để vẽ badge số trên sơ đồ.
- **§6 Đặc tả layout Excalidraw** — toạ độ x từng cột, kích thước node, thứ tự y, quy tắc frame/viền/mũi tên/legend.
- **§7 Hướng dẫn dựng HTML** — cấu trúc trang, badge trạng thái, bảng feature flags (tất cả OFF mặc định).

Cũng thêm một dòng vào bảng canonical owners trong `docs/README.md` theo quy tắc bản đồ tài liệu. Khi bạn cần, tôi có thể sinh luôn file HTML hoặc `.excalidraw` từ spec này.
