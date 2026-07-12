# CGHC-011 / CGHC-019 — Slice 3 packaged provider + credential flow

Date: 2026-07-12  
Verifier: Agent Lead (LEAN)  
Build: `dist-app/win-unpacked/Cowork GHC.exe`

## Root causes fixed

1. **Settings-only test connection**: HTTP connector was wired with `notAttachedConnector()` in settings-only composition — probe always failed. Replaced with real `createHttpConnectorBundle` (lazy credential + env spec from settings).
2. **Node 24 custom `lookup`**: `createHttpsDialer` returned `(address, family)` while Node 24+ requests `{ all: true }` and expects an address array — live probe mapped to PR7 `unknown`. Fixed lookup callback shape.
3. **IPC bootstrap gap**: `getBootstrap` IPC handler dropped `allowEnvCredentialImport`, so the dev-only env import button never appeared in packaged verification even when `COWORK_GHC_ALLOW_ENV_IMPORT=1`.

## Packaged flow observed

1. Launch with isolated `--user-data-dir` + `COWORK_GHC_ALLOW_ENV_IMPORT=1` + `DEEPSEEK_API_KEY` in spawn env (never logged).
2. Settings-only service ready (`settings_only_started`).
3. Workspace fixture activated via picker seam.
4. LLM settings: DeepSeek preset (`custom-openai-compat`, `deepseek-chat`, `https://api.deepseek.com/v1`).
5. **Import từ biến môi trường (dev)** → credential stored in Windows keyring; UI shows **Đã cấu hình** (no secret echoed).
6. **Kiểm tra kết nối** → **Kết nối thành công.** (bounded GET `/v1/models`, one live request).
7. Relaunch without `DEEPSEEK_API_KEY` in process env → provider/model restored; summary shows **Đã cấu hình** + `deepseek-chat`.
8. Clean stop → no orphan `Cowork GHC.exe` processes.

## Focused tests (PASS)

```text
node --import tsx --test app/ui/tests/llm-settings-panel.test.ts service/tests/provider-test-connection-route.test.ts service/tests/http-dialer-lookup.test.ts service/tests/credential-router.test.ts service/tests/credential-keyring.test.ts
```

## Packaged verify command

```text
npm run package:win
node tools/verify/slice3-provider-packaged.mjs
```

Result: **PASS**

## Security notes

- Renderer never receives credential bytes; only `hasCredential` / account metadata.
- `.env` used only as verification harness bootstrap; not required after keyring import.
- No secret in trace, evidence, or Git.
