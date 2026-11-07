#!/usr/bin/env sh
set -eu
repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
configuration=${1:-Debug}
case "$configuration" in Debug|Release) ;; *) printf '%s\n' 'Usage: sh scripts/build-mobile.sh [Debug|Release]' >&2; exit 2 ;; esac
cd "$repository/apps/android-vutron"
edition=auto
if [ "$#" -ge 2 ]; then edition=$2; fi
identity=$(node "$repository/scripts/mobile-build.cjs" "$edition")
VUTRON_BUILD_EDITION=$(printf '%s' "$identity" | node -e "let input='';process.stdin.on('data',v=>input+=v);process.stdin.on('end',()=>process.stdout.write(JSON.parse(input).edition))")
export VUTRON_BUILD_EDITION
if [ ! -d node_modules ]; then npm ci --ignore-scripts; fi
(cd "$repository/packages/plugin-api"; if ! node -e 'const p=require("./package.json");try{process.exit(require("zod/package.json").version===p.dependencies.zod&&require("regexpu-core/package.json").version===p.devDependencies["regexpu-core"]?0:1)}catch{process.exit(1)}'; then npm ci --ignore-scripts; fi)
node "$repository/scripts/build-plugin-api.cjs"
(cd "$repository/packages/plugin-runtime-deps"; if [ ! -d node_modules/@neteasecloudmusicapienhanced/api ]; then npm ci --ignore-scripts --omit=dev; fi)
node "$repository/scripts/vendor-plugin-dependencies.cjs"
node "$repository/scripts/runtime-regex-compat.cjs" --check
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit
npm run build
npm exec -- cap sync android
cd android
sh ./gradlew ":app:assemble$configuration" --console=plain "-PvutronEdition=$VUTRON_BUILD_EDITION"
