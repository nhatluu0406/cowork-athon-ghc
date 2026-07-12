# `.loop-engineer/` — Manifest (điều gì còn hiện hành)

> Mục đích: giúp Codex biết **file nào là nguồn sự thật hiện hành** và file nào là **provenance lịch
> sử** (không cần đọc hết). Cập nhật tay, 2026-07-12 (freeze cho handoff).

## Nguồn sự thật máy-đọc (CANONICAL — đọc trước)

| Path | Vai trò |
|---|---|
| `state/project-state.yaml` | Trạng thái dự án + loop + toolchain + reference + handoff. **Canonical.** |
| `state/loops.yaml` | Định nghĩa + gate + inputs/outputs từng loop L0–L10. **Canonical.** |
| `state/tasks.yaml` | 28 executable task (`CGHC-001`..`028`) + backlog. **Canonical.** |
| `state/current-run.yaml` | Run đang mở (RUN-0007). |
| `state/STATUS.md` | Bản xem người-đọc của state (đồng bộ tay). Nếu lệch, YAML thắng. |
| `state/TASKS.md` | Bản xem người-đọc của task (đồng bộ tay). Nếu lệch, `tasks.yaml` thắng. |

Đọc nhanh: `node tools/loop-engineer/cli.mjs status` · kiểm tra: `node tools/loop-engineer/cli.mjs verify`.

## Handoff

- `HANDOFF.md` — điểm vào cho Codex (đọc đầu tiên, ngắn).

## Evidence (summary — GIỮ trong Git)

- `evidence/L0/`..`L5/` — evidence từng loop cổng đã PASS (bootstrap, requirements, discovery,
  architecture, review, master plan). Provenance đã đóng; đọc khi cần truy vết một quyết định.
- `evidence/L6/CGHC-0NN-impl.md` — impl-note + review-disposition từng task L6 (evidence hiện hành cho
  DoD của task tương ứng). File này được `tasks.yaml` tham chiếu — **không di chuyển/xoá**.
- `evidence/CGHC-0NN-*.md` (root) — evidence bổ sung cho vài task UI/streaming/verify; cũng được
  `tasks.yaml`/`loops.yaml` tham chiếu. Hiện hành.
- `evidence/CGHC-028-release-verification.md`, `evidence/CGHC-028-packaged-launch-fix.md` —
  evidence release-verify **hiện hành** (gate PARTIAL). Đọc để hiểu vì sao packaged acceptance chưa đạt.

## Reports (canonical output — GIỮ)

- `reports/requirements-baseline-review.md` (L1), `reports/discovery-report.md` (L2),
  `reports/docs-language-audit.md` (chính sách ngôn ngữ). Canonical.

## Provenance lịch sử (GIỮ, nhưng KHÔNG cần đọc để tiếp tục)

- `checkpoints/*.yaml` — ảnh chụp checkpoint theo loop/wave (L0–L6). Chỉ để truy vết; state hiện hành
  nằm ở `state/`. Một số được STATUS.md tham chiếu — không xoá.
- `state/runs/RUN-0001..0007.yaml` — nhật ký từng run. Provenance.

## Đã gỡ bỏ

- `source/openwork/` — **ĐÃ XOÁ** (working copy 123M + nested `.git`). Provenance:
  `docs/references/openwork-reference.md`. Không bao giờ là build dependency.

## Không commit (xem `.gitignore` gốc)

- Raw runtime: `.runtime/` (logs/pids/temp), `.loop-engineer/scratch/` (trừ `.gitkeep`).
- Build/deps: `node_modules/`, `dist-app/`, `**/dist/`, coverage.
