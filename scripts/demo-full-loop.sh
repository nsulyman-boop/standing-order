#!/usr/bin/env bash
# End-to-end testnet demo with your own accounts. See README section C for the env vars.
# Idempotent: re-running skips what already exists (accounts, deploy, DAO, token setup, keeper key).
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_USE_ENV_PROXY=${NODE_USE_ENV_PROXY:-1}
T=node_modules/.bin/tsx
# Every account comes from the environment: the script never falls back to the author's accounts.
: "${SO_MASTER:?set SO_MASTER to your funded testnet account (credentials in ~/.near-credentials/testnet/)}"
: "${SO_CONTRACT:?set SO_CONTRACT to the account that receives the contract (usually = SO_MASTER)}"
: "${SO_DAO_NAME:?set SO_DAO_NAME to a unique Sputnik DAO name (becomes <name>.sputnik-v2.testnet)}"
: "${SO_COUNCIL:?set SO_COUNCIL to a comma-separated list of council sub-accounts, e.g. c1.<you>.testnet,c2.<you>.testnet}"
: "${SO_RECIPIENTS:?set SO_RECIPIENTS to a comma-separated list of recipient sub-accounts}"
: "${SO_KEEPER:?set SO_KEEPER to the keeper sub-account, e.g. keeper.<you>.testnet}"
export SO_MASTER SO_CONTRACT SO_DAO_NAME SO_COUNCIL SO_RECIPIENTS SO_KEEPER
LOG_DIR=${SO_DEMO_LOG_DIR:-/tmp/standing-order-demo}
mkdir -p "$LOG_DIR"
step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
# Extract the proposal id from a propose-* script's last stdout line ("Proposal #N is open ...").
proposal_id() { tail -1 | grep -oE 'Proposal #[0-9]+' | grep -oE '[0-9]+' | head -1; }

step "1/11 build contract";         (cd contract && cargo build --target wasm32-unknown-unknown --release 2>&1 | tail -1)
step "2/11 create sub-accounts";    $T scripts/setup-accounts.ts
step "3/11 deploy + init";          $T scripts/deploy.ts
step "4/11 create Sputnik DAO";     $T scripts/create-dao.ts
step "5/11 token storage + mint";   $T scripts/token.ts
step "6/11 fund council + keeper";  $T scripts/fund-account.ts "${SO_COUNCIL%%,*}" 3; $T scripts/fund-account.ts "$SO_KEEPER" 2
step "7/11 propose + vote plan"
# stderr (RPC retries, warnings) goes to a log file so a failure is diagnosable; stdout carries the id.
ID=$($T scripts/propose-plan.ts 2>"$LOG_DIR/propose-plan.log" | tee "$LOG_DIR/propose-plan.out" | proposal_id) || { echo "propose-plan failed or printed no proposal id, see $LOG_DIR/propose-plan.out and $LOG_DIR/propose-plan.log"; exit 1; }
[ -n "$ID" ] || { echo "could not read the proposal id, see $LOG_DIR/propose-plan.out and $LOG_DIR/propose-plan.log"; exit 1; }
$T scripts/vote.ts "$ID"
PLAN_ID=$($T scripts/status.ts 2>/dev/null | grep -oE '^Plan #[0-9]+' | grep -oE '[0-9]+' | tail -1)
PLAN_ID=${PLAN_ID:-1}
step "8/11 first run + status";     $T scripts/run-due.ts "$PLAN_ID"; $T scripts/status.ts
step "9/11 keeper: restricted key + one tick"
# keeper-key.ts adds a function-call key limited to run_due and writes keeper/.env; re-running adds
# another key (harmless, each has its own allowance), so skip it when keeper/.env already matches.
if grep -qs "^KEEPER_ACCOUNT=$SO_KEEPER\$" keeper/.env && grep -qs "^SO_CONTRACT=$SO_CONTRACT\$" keeper/.env; then
  echo "keeper/.env already holds a key for $SO_KEEPER on $SO_CONTRACT, reusing it"
else
  $T scripts/keeper-key.ts
fi
# One keeper tick with the restricted key: pays if a run is due, otherwise logs {"event":"idle"}.
CROSSCHAIN=${CROSSCHAIN:-dry} npm run --silent keeper:once
step "10/11 propose pause_plan + vote"
PID=$($T scripts/propose-call.ts pause_plan "{\"plan_id\":$PLAN_ID}" 2>"$LOG_DIR/propose-pause.log" | tee "$LOG_DIR/propose-pause.out" | proposal_id) || { echo "propose-call failed or printed no proposal id, see $LOG_DIR/propose-pause.out and $LOG_DIR/propose-pause.log"; exit 1; }
[ -n "$PID" ] || { echo "could not read the pause proposal id, see $LOG_DIR/propose-pause.out"; exit 1; }
$T scripts/vote.ts "$PID"
step "11/11 run-due on the paused plan -> expect \"Paused\", then status"
$T scripts/run-due.ts "$PLAN_ID" | tee "$LOG_DIR/run-due-paused.out"
grep -q '"outcome":"Paused"' "$LOG_DIR/run-due-paused.out" && echo "OK: run_due returned Paused, nothing moved" || echo "WARN: expected outcome Paused (see $LOG_DIR/run-due-paused.out)"
$T scripts/status.ts
printf '\nLogs in %s. Next: npm run propose:call -- resume_plan %s ; npm run vote -- <id> ; CROSSCHAIN=dry KEEPER_HTTP_PORT=8787 npm run keeper\n' "$LOG_DIR" "'{\"plan_id\":$PLAN_ID,\"skip_missed\":true}'"
