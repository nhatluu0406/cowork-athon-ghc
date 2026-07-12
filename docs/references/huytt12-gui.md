---
title: "Tham chiếu HuyTT12-GUI"
language: "vi"
status: "integrated"
updated: "2026-07-12"
---

# Tham chiếu HuyTT12-GUI

`HuyTT12-GUI` là nguồn tham chiếu giao diện dùng cho lớp trình bày của Cowork GHC. Mã nguồn tạm
thời đã được đặt tại `.loop-engineer/source/HuyTT12-GUI` trong quá trình tích hợp.

## Phạm vi đã sử dụng

- Bố cục desktop: sidebar trái, vùng hội thoại trung tâm, composer cố định, panel hoạt động bên phải.
- Hướng thiết kế "Airy": nền sáng, spacing rộng, bo góc lớn, màu nhấn cam.
- Mẫu cấu trúc Settings và trạng thái hoạt động.

## Phạm vi không sử dụng

- `src/main/**`, `src/preload/**` và các IPC/mock backend của HuyTT12-GUI không được đưa vào sản phẩm.
- Provider, credential, OpenCode, file action, attachment, history và skills mock logic không được dùng.
- CDN font/icon trong HTML nguồn không được dùng trong renderer đóng gói.

## Kết quả tích hợp

Giao diện sản phẩm hiện nằm trong `app/ui/src/app-shell.ts` và `app/ui/src/styles.css`, nối qua
`service-client` và shell bridge hiện có. Cowork GHC core vẫn là nguồn hành vi duy nhất.
