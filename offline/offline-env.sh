#!/bin/sh
# Sourced by the entry scripts; variables are confined to this process.
export PATH="$BUNDLE_ROOT/runtime/node/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$BUNDLE_ROOT/runtime/browsers"
export LD_LIBRARY_PATH="$BUNDLE_ROOT/runtime/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export FONTCONFIG_FILE="$BUNDLE_ROOT/runtime/fontconfig/fonts.conf"
export FONTCONFIG_PATH="$BUNDLE_ROOT/runtime/fontconfig"
export ALSA_CONFIG_DIR="$BUNDLE_ROOT/runtime/alsa"
export NPM_CONFIG_OFFLINE=true
export NPM_CONFIG_UPDATE_NOTIFIER=false
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
