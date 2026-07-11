#!/usr/bin/env bash
set -e
cd /mnt/c/DungPD4/ragmini

echo "=== bringing up stack ==="
docker compose down -v 2>&1 | tail -5
docker compose up -d postgres neo4j

echo "=== waiting for postgres ==="
for i in $(seq 1 30); do
  docker exec m365kg-postgres pg_isready -U m365kg >/dev/null 2>&1 && break
  sleep 1
done

echo "=== waiting for neo4j ==="
for i in $(seq 1 20); do
  docker exec m365kg-neo4j cypher-shell -u neo4j -p m365kg_dev_password 'RETURN 1' >/dev/null 2>&1 && break
  sleep 2
done

echo "=== container status before migrations ==="
docker ps -a

echo "=== applying postgres schema ==="
ROOT_DIR="/mnt/c/DungPD4/ragmini/src/m365-knowledge-graph"
docker exec -i m365kg-postgres psql -U m365kg -d m365kg < "$ROOT_DIR/migrations/001_initial_schema.sql" >/dev/null

echo "=== container status before tests ==="
docker ps -a

echo "=== running integration tests (forcing fresh execution, not cached) ==="
cd "$ROOT_DIR"
go test -tags=integration -count=1 -v ./tests/integration/retrieval/... 2>&1
TEST_EXIT=$?

echo "=== tearing down ==="
cd /mnt/c/DungPD4/ragmini
docker compose down -v 2>&1 | tail -5

exit $TEST_EXIT
