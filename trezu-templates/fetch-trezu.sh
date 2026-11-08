#!/usr/bin/env bash
# Fetch Trezu's frontend source (shallow) so check.ts can run Trezu's own manifest validator and
# proposal builder against our templates. Nothing from Trezu is redistributed in this repo.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)/.trezu-src"
if [ -d "$DIR/nt-fe" ]; then echo "trezu source present at $DIR"; exit 0; fi
git clone --depth 1 https://github.com/NEAR-DevHub/trezu "$DIR"
echo "fetched $(git -C "$DIR" rev-parse --short HEAD)"
