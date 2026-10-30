#!/bin/sh
set -eu
BUNDLE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$BUNDLE_ROOT/offline-env.sh"
cd "$BUNDLE_ROOT"
node "$BUNDLE_ROOT/verify-offline.mjs"
exec node "$BUNDLE_ROOT/scripts/start-local.mjs"
