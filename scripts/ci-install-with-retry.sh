#!/usr/bin/env bash

set -u -o pipefail

max_attempts=3
attempt=1

while true; do
  if pnpm install "$@"; then
    exit 0
  fi

  if (( attempt >= max_attempts )); then
    echo "::error::pnpm install failed after ${max_attempts} attempts"
    exit 1
  fi

  retry_delay=$((attempt * 10))
  echo "::warning::pnpm install attempt ${attempt} failed; retrying in ${retry_delay} seconds"
  sleep "${retry_delay}"
  attempt=$((attempt + 1))
done
