---
title: "OpenWork — tài liệu tham khảo (đã hoàn tất)"
language: "vi"
status: "reference-complete"
updated_at: "2026-07-12"
---

# OpenWork — Ghi chú tham khảo

Tài liệu này ghi lại việc Cowork GHC đã **tham khảo** dự án OpenWork trong giai đoạn nghiên cứu
(L1–L2). Bản sao mã nguồn OpenWork **không còn nằm trong repository** và **không phải** runtime
dependency của Cowork GHC.

## Repository đã tham khảo

- **Repository:** `different-ai/openwork`
- **Branch:** `dev`
- **Commit đã nghiên cứu (mã nguồn):** `1897f9f38ee35338bdb99a993ea07c5c9cd9b827`
- **Commit của tài liệu phân tích:** `00190e5020476478576ad21c66c1abc20d756677`
- **Bản sao cũ (đã xoá):** `.loop-engineer/source/openwork` (~123 MB, có nested `.git` riêng)

Tài liệu phân tích thu được từ giai đoạn tham khảo vẫn được giữ ở
`docs/openwork-requirements-and-basic-design.md` (research reference, tiếng Anh, không dịch, không phải
build dependency).

## Đã tham khảo những pattern sản phẩm nào

Các pattern dưới đây được **nghiên cứu để rút ra yêu cầu và thiết kế riêng của Cowork GHC**, rồi hiện
thực lại độc lập (không fork, không clone, không rebrand):

- Desktop shell tách UI khỏi một **local application service** (Cowork GHC: service bind loopback,
  ADR 0003).
- Vòng đời agent/session + streaming sự kiện tới UI (Cowork GHC: EV event contract + two-hop SSE).
- Trừu tượng **provider-neutral** cho nhiều LLM provider (Cowork GHC: ProviderPort, ADR 0005).
- Quản lý credential tách khỏi state, không để key ở nơi không an toàn (Cowork GHC: OS-backed keyring,
  ADR 0006).
- Thực thi tool trong ranh giới workspace + mô hình permission (Cowork GHC: enforce tại execution
  boundary).
- Giám sát tiến trình con trên Windows + dọn orphan (Cowork GHC: supervision + reaper).

## Ranh giới rõ ràng

- Cowork GHC là **sản phẩm riêng**. OpenWork chỉ là **tham khảo nghiên cứu**.
- Cowork GHC **không** tiếp tục phát triển bằng cách sửa hay chạy mã nguồn OpenWork.
- OpenWork **không** phải là runtime dependency và **không** nằm trong đường build.
- Không sao chép thêm nội dung OpenWork vào repository.

## Trạng thái

**Tham khảo đã HOÀN TẤT.** Không cần giữ lại bản sao mã nguồn OpenWork. Mọi yêu cầu/kiến trúc/quyết
định của Cowork GHC đã được ghi trong `docs/` (scope, implementation design, ADR) và trong state máy
tại `.loop-engineer/state/`.
