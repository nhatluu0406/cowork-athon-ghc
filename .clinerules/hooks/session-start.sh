#!/usr/bin/env bash
set -e

mkdir -p .specify/session

git status --porcelain > .specify/session/baseline.txt

cat > .specify/session/session.json <<EOF
{
  "session_id": "$(date +%Y%m%d-%H%M%S)",
  "allowed_files": []
}
EOF