#!/usr/bin/env bash
set -euo pipefail

TASK_ID="$1"

SESSION_FILE=".specify/session/session.json"

if [ ! -f "$SESSION_FILE" ]; then
    echo "No session.json found"
    exit 1
fi

ALLOWED_FILES=$(jq -r '.allowed_files[]' "$SESSION_FILE")

TMP=$(mktemp)

git diff --name-only > "$TMP"

FILES_TO_COMMIT=()

while read -r FILE; do

    if echo "$ALLOWED_FILES" | grep -Fxq "$FILE"; then
        FILES_TO_COMMIT+=("$FILE")
    fi

done < "$TMP"

if [ ${#FILES_TO_COMMIT[@]} -eq 0 ]; then
    echo "Nothing to commit"
    exit 0
fi

echo "Committing:"
printf '%s\n' "${FILES_TO_COMMIT[@]}"

git add "${FILES_TO_COMMIT[@]}"

git commit -m "${TASK_ID}

Acceptance criteria passed
Auto committed by task-complete hook"