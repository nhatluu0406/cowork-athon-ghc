<div align="center">
  <img src="docs/assets/cowork-ghc-logo-256.png" width="112" alt="Cowork GHC logo" />

# Cowork GHC

**Local-first AI workspace for Windows — chat, files, Skills, providers, permissions, and agent-assisted work in one desktop app.**

[![Windows 11](https://img.shields.io/badge/Windows-11-0078D4?logo=windows11&logoColor=white)](#requirements)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](#technology)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](#technology)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](#requirements)
[![License](https://img.shields.io/badge/License-MIT-orange)](LICENSE)
[![Status](https://img.shields.io/badge/Status-POC%20Demo-orange)](docs/product/current-status.md)

[Features](#features) · [Quick start](#quick-start) · [Configuration](#configuration) · [Architecture](#architecture) · [Roadmap](docs/product/roadmap.md) · [Documentation](docs/README.md)

</div>

---

## Overview

Cowork GHC is a Windows desktop AI cowork environment. It connects a local workspace to an LLM through a supervised OpenCode runtime, keeps credentials in Windows Credential Manager, asks for permission before sensitive actions, and preserves conversations and file-work evidence locally.

The current target is a polished, local-first POC for product demonstration—not a cloud multi-user release.

## Features

### Cowork chat

- New Chat startup and persistent conversation history
- Streaming assistant responses and bounded multi-turn context
- Conversation search, rename, and delete
- Text attachments with secret-like file blocking
- Permission modes: ask first, workspace automation, and read-only
- Verified file-action handling and File Work Review foundations

### Workspace Companion

- Workspace folder picker and guarded file navigation
- Preview for text, Markdown, images, PDF, DOCX, and XLSX within current safety limits
- Direct editing for supported small text/Markdown files
- Agent-driven file refresh with protection for unsaved edits
- Cowork conversation available alongside workspace work

### Provider profiles

- Multiple saved provider connections
- DeepSeek preset
- Custom OpenAI-compatible endpoint, model ID, and API token
- API keys stored in Windows Credential Manager
- Active provider/model presentation and readiness state

### Skills

- Built-in and user-managed local `SKILL.md` files
- Create, edit, delete, enable, and disable user Skills
- Built-in Skills remain read-only
- Skill provenance stored without persisting raw Skill instructions in chat history

### Desktop product shell

- Commercial light and dark visual system
- Native Windows titlebar controls and Snap Layout compatibility
- Product surfaces for Cowork, Dispatch, Gateway, Knowledge, Microsoft 365, and Code
- D1–D4 surfaces are integration mount points; their backends are not yet merged

## Screenshots

> Keep accepted packaged screenshots under `docs/demo/screenshots/` and update them only at a UI milestone.

| Cowork | Workspace | Settings |
|---|---|---|
| `docs/demo/screenshots/01-new-chat.png` | `docs/demo/screenshots/03-workspace.png` | `docs/demo/screenshots/02-provider-settings.png` |

## Architecture

```text
Electron renderer
    ↓ typed preload bridge
Electron main process
    ↓ loopback HTTP/SSE + capability-scoped IPC
Local application service
    ↓ supervised child process
OpenCode runtime
    ↓ provider profile
LLM endpoint
```

Core principles:

- local-first application state;
- renderer does not receive unrestricted Node.js or IPC access;
- filesystem actions stay inside the active workspace boundary;
- permission is enforced at the execution boundary;
- secrets never belong in UI state, logs, screenshots, or profile JSON;
- assistant prose is not proof that a file mutation succeeded.

See [System overview](docs/architecture/system-overview.md).

## Technology

| Layer | Technology |
|---|---|
| Desktop shell | Electron 33 |
| Renderer | TypeScript, Vite, DOM-based UI modules |
| Local service | Node.js, TypeScript, loopback HTTP/SSE |
| Agent runtime | OpenCode child process |
| Packaging | electron-builder |
| Credential storage | Windows Credential Manager via `@napi-rs/keyring` |
| Application persistence | Local JSON files written atomically; no SQL database in the current POC |
| Tests | Node test runner through `tsx` |

## Repository structure

```text
app/
  shell/            Electron main process, preload bridge, packaging
  ui/               Renderer and UI shell
core/contracts/     Shared typed contracts
service/            Local application service and business boundaries
runtime/            OpenCode runtime integration
skills/             Packaged built-in Skills
scripts/            Windows entry scripts
tools/              App lifecycle and focused verification utilities
docs/               Canonical product, architecture, quality, and demo docs
```

## Requirements

- Windows 11
- Node.js 22 or newer
- npm
- A compatible LLM API key for chat/runtime use

## Quick start

```bat
npm install
scripts\init.bat
scripts\build.bat
scripts\start.bat
```

Stop the app cleanly:

```bat
scripts\stop.bat
```

Create a safe demo workspace:

```bat
scripts\demo-seed.bat
```

## Configuration

### Provider connection

1. Open **Settings → Nhà cung cấp**.
2. Select **Thêm kết nối**.
3. Choose the DeepSeek preset or an OpenAI-compatible connection.
4. Enter display name, endpoint, model ID, and API token.
5. Test the connection and set the desired profile active.

Saved API tokens are stored in Windows Credential Manager. Profile JSON contains only non-secret metadata and credential status/handles.

### Permission mode

The composer supports:

- **Hỏi trước** — ask before file mutation or command execution;
- **Tự động trong workspace** — allow supported workspace operations according to the implemented policy;
- **Chỉ đọc** — deny mutations and execution.

For product demos, use **Hỏi trước**.

### Theme

Open **Settings → Chung** and select:

- Theo hệ thống
- Sáng
- Tối

## Development commands

```bash
npm run typecheck
npm test
npm run build:renderer
npm run build:app
npm run package:win
npm run verify:release
```

Fast pre-commit verification on Windows:

```bat
scripts\verify-fast.bat
```

## Windows scripts

| Script | Purpose |
|---|---|
| `scripts/init.bat` | Prepare the local environment idempotently |
| `scripts/build.bat` | Typecheck and package the Windows application |
| `scripts/start.bat` | Start the packaged application |
| `scripts/stop.bat` | Stop only Cowork-owned processes |
| `scripts/clean.bat` | Remove allowlisted generated artifacts |
| `scripts/demo-reset.bat` | Reset demo-safe state without deleting keyring credentials |
| `scripts/demo-seed.bat` | Create representative demo files |
| `scripts/verify-fast.bat` | Run the normal focused pre-commit checks |

See [scripts/README.md](scripts/README.md).

## Security model

- Credentials are stored in Windows Credential Manager.
- Renderer state never receives saved plaintext API keys.
- Workspace paths are validated and confined by the local service.
- Secret-like attachments and previews are blocked or redacted.
- Diagnostics use secret scrubbing.
- OpenCode runs as a supervised child process with bounded configuration.

## Current status

Cowork GHC is a POC demo candidate. Core chat, provider, Skill, workspace, theme, and permission foundations exist; remaining demo work is tracked explicitly rather than hidden behind broad “PASS” claims.

- [Current status](docs/product/current-status.md)
- [Product plan](docs/product/product-plan.md)
- [Roadmap](docs/product/roadmap.md)
- [Demo acceptance](docs/quality/demo-acceptance.md)
- [Known limitations](docs/quality/known-limitations.md)

## Contributing with coding agents

Read in this order:

1. [AGENTS.md](AGENTS.md)
2. [docs/README.md](docs/README.md)
3. [Current status](docs/product/current-status.md)
4. [Roadmap](docs/product/roadmap.md)
5. The current Git diff

Default workflow is LEAN: one agent, one bounded slice, focused verification, one meaningful commit.
