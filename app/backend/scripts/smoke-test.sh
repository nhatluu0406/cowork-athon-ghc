#!/usr/bin/env bash
# T116: Smoke test — boots the server against local PostgreSQL+Neo4j
# (docker-compose) and curls every endpoint in spec.md §13, asserting
# non-mock-crash, non-5xx responses.
#
# T188 (tasks.md Phase 10, Group J): in addition to the non-5xx wiring check,
# this script now also greps response bodies for known hardcoded-placeholder
# strings ("jwt-token-demo", "John Doe", etc.) that a prior audit found being
# returned by several handlers instead of real backend results. This guards
# against that exact regression happening again — a handler that starts
# returning fabricated/hardcoded data again will fail this script even if it
# still returns a 200.
#
# Usage: ./scripts/smoke-test.sh
# Requires: docker compose, curl, an available :8080

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT_DIR/../.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/docker-compose.yml"

BASE_URL="${BASE_URL:-http://localhost:8080}"
SERVER_PID=""
COMPOSE_STARTED=0

FAIL_COUNT=0
PASS_COUNT=0

log()  { echo "[smoke-test] $*"; }
fail() { echo "[smoke-test] FAIL: $*" >&2; FAIL_COUNT=$((FAIL_COUNT + 1)); }
pass() { echo "[smoke-test] PASS: $*"; PASS_COUNT=$((PASS_COUNT + 1)); }

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    log "stopping server (pid $SERVER_PID)"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ "$COMPOSE_STARTED" -eq 1 ]]; then
    log "stopping docker-compose stack"
    (cd "$REPO_ROOT" && docker compose down) || true
  fi
}
trap cleanup EXIT

# --- 1. Start PostgreSQL + Neo4j ---------------------------------------------

log "starting docker-compose stack (postgres + neo4j)"
(cd "$REPO_ROOT" && docker compose up -d postgres neo4j)
COMPOSE_STARTED=1

log "waiting for PostgreSQL healthcheck"
for i in $(seq 1 30); do
  if docker exec m365kg-postgres pg_isready -U m365kg >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

log "waiting for Neo4j to accept bolt connections"
for i in $(seq 1 30); do
  if (echo > /dev/tcp/localhost/7687) >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# --- 2. Apply migrations ------------------------------------------------------
# Applied via `docker exec ... psql` against the container so this script has
# no dependency on a host-installed psql client.

log "applying PostgreSQL migrations"
docker exec -i m365kg-postgres psql -U m365kg -d m365kg < "$ROOT_DIR/migrations/001_initial_schema.sql" >/dev/null
docker exec -i m365kg-postgres psql -U m365kg -d m365kg < "$ROOT_DIR/migrations/002_finetuning_schema.sql" >/dev/null || true

log "applying Neo4j schema"
# The bolt port accepting TCP does not mean cypher-shell auth is ready yet
# (Neo4j finishes its own startup/auth-init a few seconds after the port
# opens) — retry a few times before giving up.
neo4j_schema_applied=0
for i in $(seq 1 10); do
  if docker exec -i m365kg-neo4j cypher-shell -u neo4j -p m365kg_dev_password < "$ROOT_DIR/migrations/002_neo4j_schema.cypher" 2>/tmp/neo4j-schema-err; then
    neo4j_schema_applied=1
    break
  fi
  sleep 3
done
if [[ "$neo4j_schema_applied" -eq 0 ]]; then
  log "WARNING: failed to apply Neo4j schema after retries (see /tmp/neo4j-schema-err)"
fi

# --- 3. Boot the server --------------------------------------------------------

export DATABASE_URL="postgres://m365kg:m365kg_dev_password@localhost:5432/m365kg?sslmode=disable"
export NEO4J_URI="bolt://localhost:7687"
export NEO4J_USERNAME="neo4j"
export NEO4J_PASSWORD="m365kg_dev_password"
export HOST="127.0.0.1"
export PORT="8080"
export JWT_SECRET="smoke-test-secret"
export LLM_API_BASE_URL="http://localhost:9999"

log "building server binary"
(cd "$ROOT_DIR" && go build -o /tmp/m365kg-smoke-server ./cmd)

log "starting server"
/tmp/m365kg-smoke-server &
SERVER_PID=$!

log "waiting for server to accept connections"
for i in $(seq 1 20); do
  if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# --- 4. Exercise every documented endpoint (spec.md §13) ----------------------

RESPONSE_BODY_FILE="$(mktemp)"
trap 'rm -f "$RESPONSE_BODY_FILE"' EXIT

# T188: known hardcoded-placeholder strings previously returned by stub
# handlers (tasks.md Phase 9/Phase 10 audits). If any of these show up in a
# response body again, that handler has regressed back to fabricated data.
PLACEHOLDER_PATTERNS=(
  "jwt-token-demo"
  "jwt-token-demo-refreshed"
  "refresh-token-demo"
  "John Doe"
  "john@example.com"
  "\"name\": \"John\""
  "WORKS_ON\"}"
)

check_no_placeholders() {
  local path=$1
  for pattern in "${PLACEHOLDER_PATTERNS[@]}"; do
    if grep -qF "$pattern" "$RESPONSE_BODY_FILE"; then
      fail "$path response contains known placeholder string: '$pattern'"
      return
    fi
  done
  pass "$path response has no known placeholder strings"
}

check() {
  local method=$1 path=$2 expect_max=$3 body="${4:-}"
  local code
  if [[ -n "$body" ]]; then
    code=$(curl -s -o "$RESPONSE_BODY_FILE" -w '%{http_code}' -X "$method" -H 'Content-Type: application/json' -d "$body" "$BASE_URL$path")
  else
    code=$(curl -s -o "$RESPONSE_BODY_FILE" -w '%{http_code}' -X "$method" "$BASE_URL$path")
  fi
  if [[ "$code" -lt "$expect_max" && "$code" -ge 200 ]]; then
    pass "$method $path -> $code"
  else
    fail "$method $path -> $code (expected < $expect_max)"
  fi
  check_no_placeholders "$method $path"
}

check GET  "/health"                               300
check POST "/api/auth/login"                       500 '{"username":"demo","password":"demo"}'
check POST "/api/auth/token/refresh"                500 '{"refresh_token":"x"}'
check POST "/api/m365/connect"                      500 '{"name":"test","type":"onedrive","tenant_id":"t","config_json":{}}'
check GET  "/api/m365/sources"                      500
check POST "/api/m365/sync"                         500 '{"source":"onedrive:/site/drive-1"}'
check GET  "/api/m365/sync/status"                  500
check POST "/api/knowledge/query"                   500 '{"query":"who works on ProjectX?"}'
check GET  "/api/entities"                          500
check GET  "/api/entities/1"                        500
check GET  "/api/graph/nodes"                       500
check GET  "/api/graph/edges"                       500
check GET  "/api/graph/path?from=a&to=b"            500
check GET  "/api/stats/overview"                    500
check POST "/api/feedback"                          500 '{"query_id":1,"user_id":"u1","feedback_type":"like"}'
check GET  "/api/feedback/stats"                     500

# --- 5. Report -----------------------------------------------------------------

echo ""
log "results: $PASS_COUNT passed, $FAIL_COUNT failed"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 1
fi

log "all endpoints reachable — wiring smoke test OK"
