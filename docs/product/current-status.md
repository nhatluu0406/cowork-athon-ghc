---
language: "vi"
status: "active"
updated_at: "2026-07-12"
---

# Trạng thái hiện tại của Cowork GHC

## Mốc Git

- `HEAD` hiện tại: pending commit `test(release): harden provider recovery and Windows scripts`.
- Mốc packaged POC: `8df3d59` — `test(release): complete packaged L6 acceptance`.
- Mốc product docs: `7d4813f` — `chore(project): retire Loop Engineer and establish product docs`.

## Trạng thái POC

Cowork GHC đạt packaged desktop POC `poc-v0.1` cho Windows. Slice **Release Gap Hardening** vừa hoàn tất:
recovery provider (invalid key / model / base URL), `start.bat` / `clean.bat`, và lệnh regression không-live `npm run verify:release`.

Trạng thái làm việc hằng ngày: Git + `docs/product/`, `docs/quality/`, `docs/architecture/`. `.loop-engineer/` chỉ `MAINTENANCE_ONLY`.

## Năng lực đã qua packaged verification

- Vòng đời local service, workspace, provider/model, Windows keyring, OpenCode, streaming.
- Permission approve/deny, cancellation, interruption cleanup, clean-profile onboarding.
- **Invalid API key recovery** — lỗi tiếng Việt, không lộ secret, khôi phục không cần restart.
- **Invalid model recovery** — probe chat completion, lỗi `model_invalid`, khôi phục model hợp lệ.
- **Invalid base URL recovery** — lỗi mạng/base URL, khôi phục DeepSeek URL.
- `init.bat`, `stop.bat`, `start.bat` (không duplicate launch), `clean.bat` (`--yes` + xác nhận tương tác).

## Slice khuyến nghị tiếp theo

**Session Management and Resume** — danh sách session, resume packaged smoke, template re-run POC.

## Lệnh kiểm tra nhẹ

```powershell
npm run verify:release
node tools/verify/provider-recovery-packaged.mjs   # cần .env + dist-app; tối đa 3 live request
node tools/verify/minimal-packaged-smoke.mjs       # smoke cuối; 1 live test connection
```

Không chạy live regression đầy đủ trừ khi đang verify user-facing release-critical.
