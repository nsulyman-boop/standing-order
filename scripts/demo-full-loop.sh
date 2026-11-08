#!/usr/bin/env bash
# End-to-end testnet demo with your own accounts. See README section C for the env vars.
# Idempotent: re-running skips what already exists.
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_USE_ENV_PROXY=${NODE_USE_ENV_PROXY:-1}
T=node_modules/.bin/tsx
: "${SO_MASTER:?set SO_MASTER to your funded testnet account (credentials in ~/.near-credentials/testnet/)}"
step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
step "1/8 build contract";        (cd contract && cargo build --target wasm32-unknown-unknown --release 2>&1 | tail -1)
step "2/8 create sub-accounts";   $T scripts/setup-accounts.ts
step "3/8 deploy + init";         $T scripts/deploy.ts
step "4/8 create Sputnik DAO";    $T scripts/create-dao.ts
step "5/8 token storage + mint";  $T scripts/token.ts
step "6/8 fund council + keeper"; $T scripts/fund-account.ts "${SO_COUNCIL%%,*}" 3; $T scripts/fund-account.ts "${SO_KEEPER:-keeper.$SO_MASTER}" 2
step "7/8 propose + vote plan";   ID=$($T scripts/propose-plan.ts 2>/dev/null | tail -1 | grep -oE '[0-9]+' | head -1); $T scripts/vote.ts "$ID"
step "8/8 first run + status";    $T scripts/run-due.ts; $T scripts/status.ts
printf '\nNext: npm run propose:call -- pause_plan %s ; npm run vote -- <id> ; npm run run-due\n' "'{\"plan_id\":1}'"
