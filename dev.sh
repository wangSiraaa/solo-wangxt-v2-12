#!/usr/bin/env bash
# One-shot local startup: embedded PG + NestJS API + Vite dev server.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT/backend"

[ -d node_modules ] || npm install
( [ -f ../frontend/node_modules/.package-lock.json ] || (cd ../frontend && npm install) )

cleanup() {
  echo
  echo "[dev] shutting down..."
  jobs -p | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[dev] starting embedded PostgreSQL (:55444)"
npx tsx scripts/dev-pg.ts &
PG_PID=$!

# wait for the port
for _ in $(seq 1 30); do
  if (echo > /dev/tcp/127.0.0.1/55444) 2>/dev/null; then break; fi
  sleep 0.5
done

echo "[dev] starting NestJS API (:3000)"
npx ts-node src/main.ts &

echo "[dev] starting Vite (:5173)"
cd "$ROOT/frontend"
npx vite --host 0.0.0.0 &

wait
