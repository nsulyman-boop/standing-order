#!/usr/bin/env bash
# Build the contracts and run unit + sandbox tests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contract"
cargo build --target wasm32-unknown-unknown --release
(cd test-contracts/test-token && cargo build --target wasm32-unknown-unknown --release)
cargo test --lib
# The sandbox node wants 65535 open files; on capped containers use the shim (see sandbox-rlimit-shim.c).
if [ "$(ulimit -Hn)" != "unlimited" ] && [ "$(ulimit -Hn)" -lt 65535 ]; then
  [ -f "$ROOT/scripts/librlimit_shim.so" ] || cc -shared -fPIC -O2 -o "$ROOT/scripts/librlimit_shim.so" "$ROOT/scripts/sandbox-rlimit-shim.c" -ldl
  export LD_PRELOAD="$ROOT/scripts/librlimit_shim.so"
fi
cargo test --tests -- --test-threads=2 "$@"
