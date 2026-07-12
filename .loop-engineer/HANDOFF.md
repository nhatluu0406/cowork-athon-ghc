# Cowork GHC — Handoff (Codex)

Bàn giao ngắn gọn để Codex tiếp quản mà không cần lịch sử hội thoại của Claude. Cập nhật 2026-07-12.

## Bối cảnh
- **Active agent:** Loop Engineer Lead (một agent, tuần tự). Chế độ mặc định: **`LEAN`**.
- **Loop hiện tại:** **L6 (Implementation) = `RUNNING`, gate `PARTIAL`.** **KHÔNG bắt đầu L7.**
- **Git:** repo **chưa** `git init`. Pass này chỉ chuẩn bị baseline an toàn; PO tự init + commit.

## Đã hoàn tất & verify thật (unit-level, có test + review độc lập)
- Runtime pin + supervision/identity + Windows orphan reaper; loopback service boundary (token-guarded).
- Credential store OS-backed (keyring, ref-only, inject-at-spawn); redaction/diagnostics.
- Workspace boundary + validation; permission enforcement tại execution boundary; file-mutation audit.
- Provider port + SSRF hardening; EV event contract; session orchestration; two-hop SSE streaming.
- Settings store; clean.bat allowlist; lifecycle `.bat`; packaged **launch-crash fix** (`.cjs` bundles).
- Test suite xanh ở mức unit/integration; `tsc` strict clean. Chi tiết: `.loop-engineer/evidence/`.

## Mới chỉ scaffold / chưa usable trong packaged app
- Renderer onboarding (chọn folder, settings LLM, nhập credential, chat) **chưa hoàn chỉnh** trong bản
  đóng gói; backend cho onboarding + connect-live có nhưng **chưa verify end-to-end**.

## Packaged app — thất bại/UNVERIFIED hiện tại
- Local service **chưa tự khởi động/kết nối thành công** từ packaged app.
- Folder/workspace picker, provider/model/credential settings: **UNVERIFIED** trong package.
- **Chưa có luồng an toàn hoàn chỉnh để PO nhập DeepSeek token.**
- **Chưa** verify live OpenCode session từ packaged app.
- GUI/UX quality vs Claude Cowork / OpenWork: **`UNVERIFIED`**.

## Task đã reopen → `STALE` (unit evidence vẫn hợp lệ, cần re-verify end-to-end)
- `CGHC-008` workspace picker · `CGHC-011` secure add-credential + test-connection · `CGHC-019`
  provider/model settings. `CGHC-028` (release-verify) giữ `IN_PROGRESS` làm anchor của gate PARTIAL.
- Không reopen task infra/security đã có evidence hợp lệ.

## Đã dọn trong pass bàn giao
- OpenWork source (`.loop-engineer/source/openwork`, 123M + nested `.git`) **đã xoá**; provenance:
  `docs/references/openwork-reference.md`.
- Thêm `README.md`, `.gitignore`, `.loop-engineer/MANIFEST.md`, đồng bộ `STATUS.md`/`TASKS.md` với YAML.
- Đồng bộ adapter Claude/Codex; `LEAN` là mặc định trong `.agent-workflow/workflow.yaml`.

## Codex đọc trước tiên
1. `AGENTS.md` (điểm vào) · 2. file này · 3. `.loop-engineer/state/STATUS.md` + `TASKS.md`
4. `.agent-workflow/workflow.yaml` · 5. `docs/architecture/cowork-ghc-implementation-design.md` + ADRs.
Bản đồ file hiện hành: `.loop-engineer/MANIFEST.md`.

## Verify nhanh repository
```
node tools/loop-engineer/cli.mjs status     # loop/task/gate
node tools/loop-engineer/cli.mjs verify      # schema + state consistency (kỳ vọng: PASS)
npm install && npm run typecheck && npm test # (tuỳ chọn) build/test — không gọi live LLM
```

## Next product slice (đề xuất, theo thứ tự)
1. Packaged service **auto-start/connect**.
2. **Workspace folder picker** usable trong package.
3. **Provider/model/settings** usable.
4. **Secure DeepSeek credential input** (OS keyring; token chỉ vào child ENV; không log/chat/source).
5. **Real OpenCode session** từ packaged app (streaming, permission Allow/Deny, file-on-disk).
Sau đó đưa `CGHC-028` (packaged E2E) về PASS.

## Điều kiện để L6 hoàn tất
Tất cả task `DONE` (gồm 3 task reopen) **và** `CGHC-028` release-verify PASS trên **bản đóng gói**
(cài từ installer, chạy full critical path init→start→workspace→provider/model→session→streaming→
permission→file-on-disk→stop→resume→clean, gồm cả leg provider-error). Chỉ khi đó mới xét L7.

## Ràng buộc
- **Không** bắt đầu L7. **Không** build web (DEFERRED, ADR 0007). Reviewer ≠ implementer.
- DeepSeek token do PO cấp qua secure credential flow; live LLM test bounded, opt-in, không vào default suite.
