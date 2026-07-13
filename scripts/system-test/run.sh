#!/usr/bin/env bash
# REQ-205 Phase 3 (T3.1-T3.4) system-test environment.
#
# Brings up the REAL M365 Knowledge Graph stack — real PostgreSQL (real
# `postgres`/`initdb`/`pg_ctl` binaries, no Docker), real Neo4j (real `neo4j`/
# `cypher-shell` binaries, no Docker), real Go backend (`go build` + real
# process), real Rust llm-svc (`cargo build` + real process) — then runs the
# backend's own integration tests, llm-svc's own test suite, and the Cowork
# `service` workspace's M365KG integration tests
# (service/tests/knowledge/m365kg-integration.test.ts) against them.
#
# No fakes, no mocks, no proxy, and no Docker sits between any two real
# components. This script does NOT install anything (no `apt-get`, no
# downloaded binaries) — per this project's own security rule ("no
# unverified downloaded executables"; installing system packages is a
# human decision, not something a test script does silently). It requires
# PostgreSQL and Neo4j to already be installed and their CLI tools on PATH;
# see E2E_TESTING_GUIDE.md's "Prerequisites" section for install commands.
#
# Usage: ./scripts/system-test/run.sh
# Requires on PATH: initdb, pg_ctl, psql, createdb, pg_isready (PostgreSQL);
#                    neo4j, neo4j-admin, cypher-shell (Neo4j); curl, go,
#                    cargo, node/npm. An available :5432/:7687/:7474/:8080/:9090.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="$REPO_ROOT/app/backend"
LLMSVC_DIR="$REPO_ROOT/app/llm-svc"

BACKEND_BASE_URL="${BACKEND_BASE_URL:-http://localhost:8080}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-m365kg_dev_password}"
PG_PORT="${PG_PORT:-5432}"
PG_USER="${PG_USER:-m365kg}"
PG_PASSWORD="${PG_PASSWORD:-m365kg_dev_password}"
PG_DB="${PG_DB:-m365kg}"

# Real Postgres cluster lives here, reused (not wiped) across runs — same
# persistence model the old docker-compose named volume had.
PGDATA="${PGDATA:-/tmp/m365kg-systest-pgdata}"
PG_LOG="/tmp/m365kg-systest-postgres.log"

BACKEND_BIN="/tmp/m365kg-systest-backend"
BACKEND_PID_FILE="/tmp/m365kg-systest-backend.pid"
LLMSVC_BIN_DIR="$LLMSVC_DIR/target/release"

BACKEND_PID=""
LLMSVC_PID=""
PG_STARTED=0
NEO4J_STARTED=0
EXIT_CODE=0

log()  { echo "[system-test] $*"; }
fail() { echo "[system-test] FAIL: $*" >&2; }

require_cmd() {
  local missing=0
  for c in "$@"; do
    if ! command -v "$c" >/dev/null 2>&1; then
      fail "required command not found on PATH: $c"
      missing=1
    fi
  done
  if [[ "$missing" -eq 1 ]]; then
    fail "install PostgreSQL + Neo4j locally first — see E2E_TESTING_GUIDE.md's Prerequisites section"
    exit 1
  fi
}

cleanup() {
  log "cleanup: stopping real backend/llm-svc/postgres/neo4j processes"
  if [[ -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$LLMSVC_PID" ]]; then
    kill "$LLMSVC_PID" 2>/dev/null || true
    wait "$LLMSVC_PID" 2>/dev/null || true
  fi
  rm -f "$BACKEND_PID_FILE"
  if [[ "$NEO4J_STARTED" -eq 1 ]]; then
    neo4j stop || true
  fi
  if [[ "$PG_STARTED" -eq 1 ]]; then
    pg_ctl -D "$PGDATA" stop -m fast || true
  fi
}
trap cleanup EXIT

require_cmd initdb pg_ctl psql createdb pg_isready neo4j neo4j-admin cypher-shell go cargo node curl

# --- 1. Start real PostgreSQL (real binary, no Docker) -----------------------

if [[ ! -d "$PGDATA" ]]; then
  log "initializing PostgreSQL data dir at $PGDATA (first run)"
  initdb -D "$PGDATA" --auth=md5 --username="$PG_USER" --pwfile=<(printf '%s' "$PG_PASSWORD") >/dev/null
fi

log "starting PostgreSQL on :$PG_PORT"
pg_ctl -D "$PGDATA" -l "$PG_LOG" -o "-p $PG_PORT -c listen_addresses=localhost" start
PG_STARTED=1

log "waiting for PostgreSQL healthcheck"
for i in $(seq 1 30); do
  pg_isready -h localhost -p "$PG_PORT" -U "$PG_USER" >/dev/null 2>&1 && break
  sleep 1
done

log "ensuring database '$PG_DB' exists"
PGPASSWORD="$PG_PASSWORD" createdb -h localhost -p "$PG_PORT" -U "$PG_USER" "$PG_DB" 2>/dev/null || true

# --- 2. Start real Neo4j (real binary, no Docker) -----------------------------

log "setting Neo4j initial password (no-op if already set on a prior run)"
neo4j-admin dbms set-initial-password "$NEO4J_PASSWORD" 2>/dev/null || true

log "starting Neo4j"
if ! neo4j status >/dev/null 2>&1; then
  neo4j start
  NEO4J_STARTED=1
else
  log "Neo4j already running — reusing it, will not stop it on exit"
fi

log "waiting for Neo4j to accept bolt connections"
for i in $(seq 1 60); do
  (echo > /dev/tcp/localhost/7687) >/dev/null 2>&1 && break
  sleep 2
done

# --- 3. Apply migrations (real schema, same files backend ships with) -------

log "applying PostgreSQL migrations"
PGPASSWORD="$PG_PASSWORD" psql -h localhost -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" < "$BACKEND_DIR/migrations/001_initial_schema.sql" >/dev/null
PGPASSWORD="$PG_PASSWORD" psql -h localhost -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" < "$BACKEND_DIR/migrations/002_finetuning_schema.sql" >/dev/null || true
PGPASSWORD="$PG_PASSWORD" psql -h localhost -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" < "$BACKEND_DIR/migrations/003_embedding_jobs_columns.sql" >/dev/null || true

log "applying Neo4j schema"
neo4j_schema_applied=0
for i in $(seq 1 10); do
  if cypher-shell -a bolt://localhost:7687 -u neo4j -p "$NEO4J_PASSWORD" < "$BACKEND_DIR/migrations/002_neo4j_schema.cypher" 2>/tmp/m365kg-neo4j-schema-err; then
    neo4j_schema_applied=1
    break
  fi
  sleep 3
done
[[ "$neo4j_schema_applied" -eq 0 ]] && log "WARNING: failed to apply Neo4j schema after retries (see /tmp/m365kg-neo4j-schema-err)"

# --- 4. Start the REAL llm-svc (real Rust process) ---------------------------

log "building llm-svc (release)"
(cd "$LLMSVC_DIR" && cargo build --release --bin llm-svc)

log "starting llm-svc"
export LLMSVC_ADDR="0.0.0.0:9090"
(cd "$LLMSVC_DIR" && "$LLMSVC_BIN_DIR/llm-svc") &
LLMSVC_PID=$!

log "waiting for llm-svc to accept connections on :9090"
for i in $(seq 1 30); do
  (echo > /dev/tcp/localhost/9090) >/dev/null 2>&1 && break
  sleep 1
done

# --- 5. Start the REAL Go backend (real process) -----------------------------

export DATABASE_URL="postgres://$PG_USER:$PG_PASSWORD@localhost:$PG_PORT/$PG_DB?sslmode=disable"
export NEO4J_URI="bolt://localhost:7687"
export NEO4J_USERNAME="neo4j"
export NEO4J_PASSWORD="$NEO4J_PASSWORD"
export HOST="127.0.0.1"
export PORT="8080"
export JWT_SECRET="system-test-secret"
export ALLOWED_ORIGINS="http://localhost:5173"
export LLMSVC_ADDR="localhost:9090"
# Dev username/password login fallback — the backend's OWN real auth code
# path (handlers_auth.go), only reachable when these are explicitly set.
# Not a test double: this IS how a developer logs in locally too.
export DEV_LOGIN_USERNAME="${DEV_LOGIN_USERNAME:-system-test}"
export DEV_LOGIN_PASSWORD="${DEV_LOGIN_PASSWORD:-system-test-password}"

log "building backend"
(cd "$BACKEND_DIR" && go build -o "$BACKEND_BIN" ./cmd)

log "starting backend"
"$BACKEND_BIN" &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$BACKEND_PID_FILE"

log "waiting for backend to accept connections"
for i in $(seq 1 30); do
  curl -sf "$BACKEND_BASE_URL/health" >/dev/null 2>&1 && break
  sleep 1
done

# --- 6. Run the real test suites against the real running stack -------------

log "running backend integration tests (go test -tags=integration)"
(cd "$BACKEND_DIR" && go test -tags=integration ./tests/integration/... -v) || EXIT_CODE=1

log "running llm-svc test suite (cargo test)"
(cd "$LLMSVC_DIR" && cargo test) || EXIT_CODE=1

log "running Cowork service M365KG integration tests (T3.1-T3.4)"
(
  cd "$REPO_ROOT" &&
  M365KG_INTEGRATION_TESTS=1 \
  M365KG_BASE_URL="$BACKEND_BASE_URL" \
  M365KG_DEV_USERNAME="$DEV_LOGIN_USERNAME" \
  M365KG_DEV_PASSWORD="$DEV_LOGIN_PASSWORD" \
  M365KG_BACKEND_PID_FILE="$BACKEND_PID_FILE" \
  M365KG_BACKEND_BIN="$BACKEND_BIN" \
  M365KG_NEO4J_PASSWORD="$NEO4J_PASSWORD" \
  node --import tsx --test service/tests/knowledge/m365kg-integration.test.ts
) || EXIT_CODE=1

if [[ "$EXIT_CODE" -eq 0 ]]; then
  log "all real-stack system tests passed"
else
  fail "one or more real-stack system tests failed — see output above"
fi

exit "$EXIT_CODE"
