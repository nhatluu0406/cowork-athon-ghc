#!/usr/bin/env bash
# Docker-based wrapper for scripts/system-test/run.sh
# Builds the m365kg-system-test image (if needed) and runs run.sh inside the container.
#
# Usage: ./scripts/system-test/docker-run.sh [--rebuild] [additional docker run args]
#   --rebuild: Force docker build (no-cache)
#   Additional args are passed to 'docker run'

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_NAME="m365kg-system-test"
IMAGE_TAG="latest"
REBUILD=0

# Parse arguments
DOCKER_RUN_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild)
      REBUILD=1
      shift
      ;;
    *)
      DOCKER_RUN_ARGS+=("$1")
      shift
      ;;
  esac
done

echo "[docker-run.sh] Building Docker image: $IMAGE_NAME:$IMAGE_TAG"
if [[ $REBUILD -eq 1 ]]; then
  echo "[docker-run.sh] (--rebuild flag: forcing --no-cache)"
  docker build --no-cache -t "$IMAGE_NAME:$IMAGE_TAG" "$SCRIPT_DIR" || exit 1
else
  docker build -t "$IMAGE_NAME:$IMAGE_TAG" "$SCRIPT_DIR" || exit 1
fi

echo "[docker-run.sh] Running $IMAGE_NAME:$IMAGE_TAG with run.sh inside"
docker run --rm \
  --privileged \
  -v "$REPO_ROOT:/workspace" \
  -w /workspace \
  "${DOCKER_RUN_ARGS[@]}" \
  "$IMAGE_NAME:$IMAGE_TAG" \
  -c "./scripts/system-test/run.sh"
