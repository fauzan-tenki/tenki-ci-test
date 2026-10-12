#!/usr/bin/env bash
# Renders templates/bench.yml for each system so every system runs identical steps.
set -euo pipefail
cd "$(dirname "$0")/.."
TENKI_RUNNER="${TENKI_RUNNER:-tenki-staging-standard-small-2c-4g}"
render() { sed -e "s|__RUNNER__|$1|g" -e "s|__SYSTEM__|$2|g" templates/bench.yml > "$3"; echo "wrote $3 ($2 on $1)"; }
render "$TENKI_RUNNER" tenki-ci .tenki/workflows/bench.yml
render ubuntu-latest github-hosted .github/workflows/bench.yml
render "$TENKI_RUNNER" tenki-runner .github/workflows/bench-tenki-runner.yml
