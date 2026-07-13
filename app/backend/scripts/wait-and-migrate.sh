#!/usr/bin/env bash
set -e
for i in $(seq 1 30); do
  docker exec m365kg-postgres pg_isready -U m365kg >/dev/null 2>&1 && break
  sleep 1
done
echo "postgres ready"

for i in $(seq 1 15); do
  docker exec m365kg-neo4j cypher-shell -u neo4j -p m365kg_dev_password 'RETURN 1' >/dev/null 2>&1 && break
  sleep 2
done
echo "neo4j ready"

ROOT_DIR="/mnt/c/DungPD4/ragmini/src/m365-knowledge-graph"
docker exec -i m365kg-postgres psql -U m365kg -d m365kg < "$ROOT_DIR/migrations/001_initial_schema.sql" >/dev/null
docker exec -i m365kg-postgres psql -U m365kg -d m365kg < "$ROOT_DIR/migrations/002_finetuning_schema.sql" >/dev/null || true
echo "postgres schema applied"

docker exec -i m365kg-neo4j cypher-shell -u neo4j -p m365kg_dev_password < "$ROOT_DIR/migrations/002_neo4j_schema.cypher" >/dev/null || true
echo "neo4j schema applied"
