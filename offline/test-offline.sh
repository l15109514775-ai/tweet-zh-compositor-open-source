#!/bin/sh
set -eu
BUNDLE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$BUNDLE_ROOT/offline-env.sh"
cd "$BUNDLE_ROOT"
node "$BUNDLE_ROOT/verify-offline.mjs"
exec node --test --test-concurrency=1 "$BUNDLE_ROOT/tests/acceptance.test.mjs" "$BUNDLE_ROOT/tests/regression.test.mjs"
