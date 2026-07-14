# End-to-End / System Testing Guide (v2.1)

> v1.0 of this guide (see git history) described a standalone `Frontend/` React app with its own
> `/login`, `/dashboard`, `/search` routes and Playwright suite. That `Frontend/` directory was
> removed and fully absorbed into `app/ui` (the Cowork GHC renderer) — see
> `docs/product/current-status.md`. v2.0 rewrote this for the current `app/backend`/`app/llm-svc`
> layout but still used `docker compose` for PostgreSQL/Neo4j. v2.1 (this version) drops Docker
> entirely — PostgreSQL and Neo4j now run as real local binaries too, same as the backend/llm-svc
> already did, so nothing in this environment depends on Docker.

## Overview

The real M365 Knowledge Graph stack, and how Cowork GHC's `service` workspace talks to it,
end-to-end, with **no fakes, no mocks, no proxy, no Docker** between any two real components:

- **PostgreSQL**: real `postgres`/`initdb`/`pg_ctl` binaries, run directly on the host.
- **Neo4j**: real `neo4j`/`cypher-shell`/`neo4j-admin` binaries, run directly on the host.
- **Backend**: real Go process (`app/backend`), built and run directly on the host.
- **llm-svc**: real Rust process (`app/llm-svc`), built and run directly on the host.
- **Cowork `service`**: the same `KnowledgeSourceClient` (`service/src/knowledge/m365kg-client.ts`)
  that ships in the packaged desktop app, pointed at the real backend above.

`docker-compose.yml` at the repo root still exists and is still used by `app/backend`'s own
pre-existing `scripts/smoke-test.sh` / `tests/integration/*` (REQ-204, out of scope to change) —
this system-test environment (REQ-205 Phase 3) just doesn't depend on it.

## First Launch (packaged desktop app) vs. this guide's system-test environment

**These are two different stacks — do not confuse them.** Everything below (Prerequisites,
`scripts/system-test/run.sh`, manually installing PostgreSQL/Neo4j via `apt-get`) is for a
**developer/CI test machine** running `run.sh` to exercise `service/tests/knowledge/
m365kg-integration.test.ts` (T3.1–T3.4) — that still needs real Postgres/Neo4j installed on that
machine, unchanged by ADR 0010.

Separately, the **packaged Cowork GHC desktop app** (what an end user actually launches) now
bundles and self-provisions its own PostgreSQL + Neo4j + Go backend + `llm-svc` (ADR 0010,
`docs/architecture/decisions/0010-m365kg-stack-bundling.md`) — an end user does **not** install
anything, run Docker, or run `scripts/system-test/run.sh`:

- **First launch**: the app downloads (network required) and extracts the bundled binaries under
  `<userData>/m365kg-stack/`, then `M365KGStackInitializer`
  (`service/src/knowledge/stack/stack-initializer.ts`) runs `initdb`, sets the Neo4j initial
  password, and applies the backend's DB migrations — all once, automatically. Expect roughly
  30–60 seconds before the M365KG feature is ready; the main Cowork chat window is not blocked by
  this (see `app/shell/src/service/m365kg-stack-launch.ts`'s header for the honest-degrade policy —
  a failure here never blocks the rest of the app).
- **Every launch after that**: `M365KGStackInitializer.isInitialized()` sees the
  `.runtime/m365kg-init.done` marker and skips straight to starting the already-initialized stack —
  fast, no re-provisioning, no re-running `initdb`.
- **For developers**: init is idempotent and safe to re-trigger in test scenarios — delete
  `<userData>/m365kg-stack/` (or the dev equivalent, `.runtime/m365kg-stack/` under the repo root)
  and `.runtime/m365kg-init.done` to force a clean first-launch run again.

## Prerequisites

Install PostgreSQL and Neo4j **locally** — `scripts/system-test/run.sh` does not install
anything itself (no `apt-get`, no downloaded binaries — installing system packages is a human
decision, not something a test script should do silently).

**Debian/Ubuntu**:
```bash
sudo apt-get install -y postgresql postgresql-client
# stop+disable the apt-started default cluster/service — run.sh manages its own instance
# on the same default port instead:
sudo systemctl stop postgresql && sudo systemctl disable postgresql

# Neo4j is not in the default Ubuntu repos — add Neo4j's own signed apt repo:
curl -fsSL https://debian.neo4j.com/neotechnology.gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/neo4j.gpg
echo "deb [signed-by=/usr/share/keyrings/neo4j.gpg] https://debian.neo4j.com stable 5" | sudo tee /etc/apt/sources.list.d/neo4j.list
sudo apt-get update && sudo apt-get install -y neo4j
sudo systemctl stop neo4j && sudo systemctl disable neo4j
```

Also needed: Go (see `app/backend/go.mod`), Rust (stable), a `protoc` binary on `PATH` (llm-svc's
`tonic-build` needs it at compile time — network access is also required at compile time, since
the `ort` crate downloads a prebuilt ONNX Runtime the first time it builds), Node 22+, `curl`.

`.github/workflows/system-test.yml` runs the exact same install steps in CI (`ubuntu-latest`).

## One-command run

```bash
./scripts/system-test/run.sh
```

This script (see its header comment for the exact sequence) checks all required binaries are on
`PATH` first, then: initializes (once) and starts a real local PostgreSQL cluster, starts (or
reuses an already-running) real local Neo4j, applies migrations, builds and starts the real
llm-svc and backend processes, then runs:

1. `go test -tags=integration ./tests/integration/...` (`app/backend`'s own suite)
2. `cargo test` (`app/llm-svc`'s own suite)
3. `service/tests/knowledge/m365kg-integration.test.ts` (REQ-205 T3.1–T3.4, Cowork-side) — gated
   behind `M365KG_INTEGRATION_TESTS=1`, which `run.sh` sets automatically for this one run.

All real processes are torn down in a `trap` on exit, including on failure. PostgreSQL's data
directory (`$PGDATA`, default `/tmp/m365kg-systest-pgdata`) and Neo4j's own data directory persist
across runs — same persistence model the old Docker named volumes had; nothing here is wiped
automatically between runs.

## What T3.1–T3.4 actually verify

| Task | Scenario | Real mechanism used (no fakes) |
|---|---|---|
| T3.1 | Real round trip | `checkHealth()` → real `GET /api/stats/overview` on the real backend |
| T3.2 | Happy path / citation appears | Seeds a real `Person`/`Project`/`OWNS` fixture via the real `cypher-shell` binary against real Neo4j, then a real `query()` call recognizes it (backend Stage 2 NER) and a real `getGraph()` call returns it |
| T3.3 | M365KG stack stopped mid-session | Sends a real `SIGTERM` to the real backend process's PID, waits for the real TCP port to close, then asserts `unavailable` |
| T3.4 | Timeout boundary (35s) | Sends a real `SIGSTOP` to the real backend process's PID (holding past 35s) then `SIGCONT` — the backend process is *actually* not scheduled to run, not simulated |

T3.2 deliberately seeds only Neo4j (not Postgres chunks/embeddings): backend Stage 2 (query-time
entity recognition) and Stage 3 (graph expansion) already run purely against Neo4j and are
sufficient to produce a real, non-empty citation and drive a real llm-svc-backed answer
generation call — this avoids inventing a new `grpcurl`-based embedding-seeding path for the
Postgres/`chunk_embeddings` (semantic-search-only) citation kind, which T3.2 does not need to
demonstrate the acceptance criterion ("citation appears").

## Running pieces individually (debugging)

### 1. Start PostgreSQL (real binary)
```bash
initdb -D /tmp/m365kg-systest-pgdata --auth=md5 --username=m365kg --pwfile=<(printf 'm365kg_dev_password')
pg_ctl -D /tmp/m365kg-systest-pgdata -l /tmp/m365kg-systest-postgres.log -o "-p 5432 -c listen_addresses=localhost" start
PGPASSWORD=m365kg_dev_password createdb -h localhost -p 5432 -U m365kg m365kg
```

### 2. Start Neo4j (real binary)
```bash
neo4j-admin dbms set-initial-password m365kg_dev_password   # first run only
neo4j start   # or: neo4j console (foreground)
```

### 3. Apply migrations (see `scripts/system-test/run.sh` §3 for the exact commands)

### 4. Start llm-svc
```bash
cd app/llm-svc
LLMSVC_ADDR=0.0.0.0:9090 cargo run --release --bin llm-svc
```

### 5. Start the backend
```bash
cd app/backend
export DATABASE_URL="postgres://m365kg:m365kg_dev_password@localhost:5432/m365kg?sslmode=disable"
export NEO4J_URI="bolt://localhost:7687"
export NEO4J_USERNAME="neo4j"
export NEO4J_PASSWORD="m365kg_dev_password"
export JWT_SECRET="dev-secret"
export LLMSVC_ADDR="localhost:9090"
export DEV_LOGIN_USERNAME="dev"
export DEV_LOGIN_PASSWORD="dev-password"
go run ./cmd
# Verify: curl http://localhost:8080/health
```

### 6. Run just the Cowork-side integration tests
```bash
M365KG_INTEGRATION_TESTS=1 \
M365KG_BASE_URL=http://localhost:8080 \
M365KG_DEV_USERNAME=dev \
M365KG_DEV_PASSWORD=dev-password \
M365KG_BACKEND_PID_FILE=/path/to/a/pidfile/containing/the/go-run/PID \
node --import tsx --test service/tests/knowledge/m365kg-integration.test.ts
```

### Backend / llm-svc's own test suites (no M365KG_INTEGRATION_TESTS needed)
```bash
cd app/backend && go test ./...                              # unit, always runs
cd app/backend && go test -tags=integration ./tests/integration/...  # needs Postgres+Neo4j up
cd app/llm-svc && cargo test                                  # unit + integration
```

## CI

`.github/workflows/system-test.yml` installs PostgreSQL/Neo4j via their own apt packages/repo on
`ubuntu-latest`, disables the systemd-auto-started default instances (so `run.sh`'s own
start/stop lifecycle — identical to local dev — owns them for the job), then runs
`scripts/system-test/run.sh`. Triggered on changes under `app/backend/`, `app/llm-svc/`,
`service/src/knowledge/`, `service/tests/knowledge/`, or `scripts/system-test/`.

## Troubleshooting

**`run.sh` exits immediately with "required command not found on PATH"**: install the missing
PostgreSQL/Neo4j tool per Prerequisites above — the script deliberately does not install anything
itself.

**PostgreSQL/Neo4j fail to start — port already in use**: something else (often a systemd-managed
default instance from the apt install) is already bound to `:5432`/`:7687`. `sudo systemctl stop
postgresql neo4j && sudo systemctl disable postgresql neo4j` frees the ports for `run.sh`'s own
instances.

**llm-svc build fails on `ort`/ONNX Runtime**: this is a network-at-build-time dependency (the
`ort` crate downloads a prebuilt ONNX Runtime the first time `cargo build` runs for it). Confirm
outbound network access from the build environment.

**`M365KG_INTEGRATION_TESTS` tests hang**: they should never hang — every scenario is bounded
(35s query timeout, explicit `SIGCONT`/process-kill cleanup). A hang means the real backend
process died in a way `run.sh` didn't detect; check `/tmp/m365kg-systest-postgres.log`, Neo4j's
own log (`$NEO4J_HOME/logs/neo4j.log` or `journalctl -u neo4j` if systemd-managed), and whatever
captured the backend process's own stdout/stderr.

## Out of scope for this guide

- The standalone M365 Knowledge Graph web frontend (`/login`, `/dashboard`, `/graph` routes,
  Playwright suite) described in v1.0 of this guide no longer exists as a separate app — that
  surface is now Cowork GHC's Knowledge Panel/Settings (`app/ui/src/knowledge-*.ts`), covered by
  `app/ui/tests/knowledge-*.test.ts` (component-level, no real backend needed) and this guide's
  T3.2 (real backend, via the Cowork `service` client).
- Real Microsoft 365 tenant sync (`M365_TENANT_ID`/`M365_CLIENT_ID`/`M365_CLIENT_SECRET`) is out
  of scope for this environment — it requires real Entra ID app-registration credentials this
  environment does not have. T3.2 seeds Neo4j fixture data directly instead of running a real
  M365 sync (see the table above).
- `app/backend`'s own `scripts/smoke-test.sh` and `docker compose`-based integration test
  convention (REQ-204) are unchanged by this guide — they still use Docker for Postgres/Neo4j,
  independently of `scripts/system-test/run.sh`.

---

**Status**: v2.1 — no Docker dependency anywhere in this environment.
**Supersedes**: v2.0 (Docker-based Postgres/Neo4j), v1.0 (`Frontend/`-based, removed).
