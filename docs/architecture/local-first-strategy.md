---
language: "en"
status: "active"
updated_at: "2026-07-18"
owner: "architecture"
---

# Local-First Strategy

**Goal.** Everything except intrinsically-cloud features (LLM provider, Microsoft 365,
Dispatch/mobile-remote when the user turns it on) must run locally with no third-party account and no
user-run containers. Knowledge Base and Knowledge Graph must work **offline**, with data inside the
Cowork data root. This document classifies every dependency, evaluates the Knowledge storage options,
and lays out an ordered migration. It **plans**; it does not perform large migrations.

See `dependencies-and-services.md` for the code-derived inventory this builds on.

## 1. Where we already are

The **core product is already local-first**: renderer → loopback service → SQLite + encrypted vault
→ supervised `opencode.exe` (bundled). The only external egress is opt-in (provider, MS365, remote).
No telemetry SDK, no CDN. This is the quality bar to hold.

The **gap is entirely D3** (Knowledge/RAG/Graph): its code chose a local-first design already
(download portable Postgres + Neo4j + JRE, run the Go backend + Rust `llm-svc` on loopback) but that
design is **dormant, unverified, and unbundled** (`dependencies-and-services.md §5`).

## 2. Dependency classification

### A. Essential external product service (opt-in, cloud by nature)

| Service | Requirement |
|---|---|
| LLM provider (OpenAI-compatible endpoint/token) | explicit config; readiness + status bar; HTTPS-only via SSRF policy; secret in vault; offline → clear error, never fake |
| Microsoft 365 / Graph (D2) | flag + manual token/device-code; disconnected shell is honest; tokens in vault |
| Dispatch/mobile remote, Discord (D1 remote) | dev/demo flags, OFF by default; LAN has **no TLS yet** (documented) |

These stay external. Requirement: opt-in, readiness, offline/error behavior, secret handling, and a
data-disclosure note each.

### B. Bundled local process (should ship with the app, loopback-supervised)

| Process | Today | Target |
|---|---|---|
| `opencode.exe` | IMPLEMENTED — bundled, supervised | keep |
| `llm-svc` (Rust, ONNX/GGUF embeddings) | DORMANT, unbundled | build in CI → bundle → supervise on loopback |
| Go backend (`m365-knowledge-graph.exe`) | DORMANT, unbundled | build in CI → bundle → supervise on loopback |
| Neo4j + JRE (if kept) | download-at-first-run design, unverified | see §4 decision |
| PostgreSQL | download-at-first-run design, unverified | see §4 decision |

Requirements for this class: loopback bind, lifecycle supervisor, health/readiness, bounded logs,
graceful stop, controlled/random port, and **no separate runtime install on the user's machine**.

### C. Embedded local library / database

| Library | Status |
|---|---|
| SQLite (`better-sqlite3`) | IMPLEMENTED — source of truth |
| Encrypted vault (in-process) | IMPLEMENTED |
| ONNX Runtime / GGUF (inside `llm-svc`) | DORMANT — pure/near-pure local inference |

### D. Development-only tools (must never become end-user runtime deps)

Go, Rust + MSVC, protoc, Docker, `tools/system-test`, JRE-for-build. `init.bat` may *check* for these
only when building from source, must report how to install them, and must never silently install
system software.

### E. Accidental third-party dependency

None found in the running app. The Go backend's finetuning package references an Anthropic client and
the connectors reach Microsoft Graph — both live inside the dormant D3 code and are **not** reachable
from the packaged app today. If D3 is activated, the Anthropic finetuning path must be treated as
class A (opt-in external) or removed for the local-first build.

## 3. Knowledge Base & Knowledge Graph — what the code actually uses

- **Graph:** Neo4j (Go driver `neo4j-go-driver/v5`, `bolt://`), via downloaded Neo4j **Community**
  (GPLv3) + Temurin JRE. Store/query/migration/traversal implemented in `app/backend/internal/graph`.
- **Metadata/relational:** PostgreSQL (`lib/pq`), downloaded portable build; migrations under
  `app/backend/migrations`.
- **Embeddings:** local Rust `llm-svc` (ONNX + GGUF, CPU) over gRPC; `BatchProcessor` job pipeline
  exists but **no caller invokes it** (POC gap).
- **Parsers:** Go (docx/pptx/xlsx/text/pdf).
- Neither Aura nor any cloud graph is used. There is **no container in the runtime path**.

## 4. Knowledge storage — options & recommendation

Evaluated against: offline, setup UX, package size, memory, startup, Windows compatibility,
licensing/redistribution, backup, migration, query capability, graph visualization, dev complexity,
exhibition reliability.

| Option | Offline | Setup UX | Size/Mem | License | Graph queries | Exhibition risk |
|---|---|---|---|---|---|---|
| **1. Embedded SQLite + FTS/vector + graph tables** | ✅ | ✅ none | ✅ small | ✅ permissive | ⚠️ adjacency/CTE only, no Cypher | ✅ lowest |
| **2. Bundled local graph service** (e.g. embedded/other-license graph) | ✅ | ✅ | ➖ medium | depends | ✅ good | ➖ integration work |
| **3. Bundled/downloaded Neo4j + JRE, supervised** (current code) | ✅ after provision | ⚠️ 1st-run download + JRE | ❌ large (JVM) | ❌ **GPLv3** redistribution | ✅ full Cypher | ⚠️ JVM/port/first-run |
| **4. Neo4j via Docker** | ✅ if image cached | ❌ user must run Docker | ❌ | ❌ GPLv3 | ✅ | ❌ violates "no container" |
| **5. Neo4j Aura / cloud** | ❌ | ❌ account | — | — | ✅ | ❌ violates offline/no-account |

> **Status (2026-07-18): Option 1 MVP landed** (code + tests + build; packaged PO observation
> pending). Implemented in `service/src/knowledge-local/` (migration id:4, repository, indexer,
> service) + `/v1/knowledge-local/*` router + the real Knowledge surface. **Keyword FTS5 search + a
> deterministic node/edge graph (workspace→folder→file + Markdown links)** — no vector/embeddings and
> no `llm-svc` dependency yet (LF-3 remains open; semantic recall is deferred, not faked). The Go
> backend / Neo4j / Postgres provisioning (Options 3–5, LF-6/LF-7) stays dormant and optional.

**Recommendation.**

- **Exhibition target: Option 1** — implement Knowledge Base + a *useful* Knowledge Graph on the
  embedded SQLite already in the app (FTS5 for search, a small vector column/extension for semantic
  recall, and node/edge tables for the graph), with the Rust `llm-svc` bundled for local embeddings.
  This is the only option that is fully offline, account-free, container-free, permissively licensed,
  inside the Cowork data root, and low-risk for a live demo. Graph visualization is driven from the
  node/edge tables.
- **Keep Option 3's provisioning/supervisor code** as an *advanced/optional* "full Cypher" backend
  behind an explicit opt-in, **only after** it is actually run against real Windows binaries and the
  **Neo4j GPLv3 redistribution** question is resolved with the Product Owner. Do not make it the
  default; do not bundle Neo4j/JRE for the exhibition.
- **Reject Options 4 and 5** for the product runtime (Docker/cloud/account) — dev/test only.

Either way the KB/KG surface must expose: status, health, rebuild, clear, and recovery; open with no
Internet; require no third-party account; store data under the Cowork data root.

## 5. Go integration plan

```text
Go source (app/backend) → CI build to coworkghc-knowledge.exe (Windows) → bundle via
electron-builder extraResources → local supervisor starts it → bind 127.0.0.1 (random port) →
health/readiness → graceful tree-kill on stop.
```

- End users must **not** need Go. Build happens in CI/dev (`tools/native-build/build-backend.bat`).
- `init.bat` checks for Go **only** when building from source, prints the exact version + install
  URL, never auto-installs.
- Prefer a pinned, checksum-verified prebuilt binary for non-Go-developer workflows.
- The backend must be reworked to the local-first profile (embedded storage per §4; the Anthropic
  finetuning + Graph-connector paths gated or removed) before it is wired in.

## 6. Docker plan

Docker is **dev/test-only today** and must stay that way. No `init.bat` Docker install/enable. If any
future feature is tempted toward Docker at runtime, replace it with an embedded library or a bundled
supervised binary instead; if a service is genuinely optional and absent, the packaged app must show
a clear "not available" state, never a fake ready state.

## 7. Migration roadmap (no time estimates; S/M/L complexity)

| ID | Step | Complexity | Priority | Acceptance |
|---|---|---|---|---|
| LF-1 | Document truth (this doc + `dependencies-and-services.md`) | S | P0 | Docs merged; `current-status.md` reconciled |
| LF-2 | Decide KB/KG architecture with PO (recommend Option 1) | S | P0 | ADR recorded; Neo4j GPLv3 decision explicit |
| LF-3 | Bundle + supervise Rust `llm-svc` on loopback (local embeddings) | M | P1 | Packaged app starts `llm-svc`; health OK; graceful stop; no orphan |
| LF-4 | KB on embedded SQLite (FTS + vector) + local import → chunk → embed | M | P1 | Import a local folder offline; search returns results; data under data root |
| LF-5 | Knowledge Graph on node/edge tables + visualization | M | P2 | Graph builds from imported docs; renders; rebuild/clear/recovery |
| LF-6 | Wire the Go backend (local-first profile) OR fold its parsers/logic into the service | L | P2 | Composed, loopback, health, bundled; end user needs no Go |
| LF-7 | (Optional) Verify + gate the Neo4j/Postgres provisioning path behind opt-in | L | P3 | Runs against real Windows binaries once; opt-in; licensing resolved |
| LF-8 | KB/KG status/health/rebuild/clear/recovery UX + offline states | M | P1 | Every state observable in packaged app |

Data migration, rollback, and compatibility are per-step concerns tracked in
`exhibition-readiness-plan.md` (workstreams 1–2). **No large migration is performed in the audit
task that produced this document.**
