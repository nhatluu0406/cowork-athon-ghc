---
name: project-repo-structure
description: This repo hosts two merged monorepos (M365 Knowledge Graph + Cowork GHC) — architecture and status snapshot as of 2026-07-12
metadata:
  type: project
---

This repository (`/home/dungpham/m365-knowledge-graph`) contains two originally-separate projects merged onto branch `204-implement-final-gaps`:

1. **M365 Knowledge Graph** (REQ-204, `specs/REQ-204-M365-001-m365-knowledge-graph/`) — Go backend (`/backend`), Rust gRPC LLM service (`/llm-svc`), React 19 frontend (`/Frontend`), Neo4j + PostgreSQL. As of 2026-07-12 this is **complete**: Go 43/43 tests, Rust 43/43 tests, Frontend built with Playwright E2E coverage (see `tasks.md` Phase 11 audit — note the audit's own "Frontend not started" line is stale; Frontend was added in later commits `54af1cd`/`25ac366`, always verify current git state over an audit doc's claims).
2. **Cowork GHC** — the repo's actual primary product identity (root `package.json` name is `"cowork-ghc"`). Electron desktop app for Windows 11: `/service` (Node/TS local HTTP service, loopback-only), `/runtime` (thin OpenCode pin/launch-config library), `/app/ui` (renderer — **plain TypeScript + DOM, NOT React**, despite `package.json` noting "React/UI in later tasks"), `/app/shell` (Electron main process), `/tools/loop-engineer` + `/scripts/*.bat` (Windows build/verify tooling).

**Why:** Before REQ-205, these two halves had **zero code-level wiring** — confirmed by grep (no cross-references in either direction) and by `package.json`'s `workspaces` array (`core/*`, `service`, `runtime`, `app/*` — excludes `backend`/`llm-svc`/`Frontend`) and `docker-compose.yml` (only Postgres+Neo4j, no backend/llm-svc containers).

**How to apply:** Any future work spanning both halves needs the same kind of survey (repository-researcher) before designing — don't assume either side's conventions apply to the other. See [[cowork-ghc-governance]] and [[req205-integration-decisions]].
