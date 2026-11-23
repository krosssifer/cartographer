#!/usr/bin/env bash
# Прогон скриптовых (не браузерных) тестов: esbuild-бандл → node.
# node --experimental-strip-types не умеет импорты без расширений, поэтому бандлим.
set -eo pipefail
mkdir -p .tmp
for t in structured-gen-test crypt-test layout-test object-size-test settlement-move-test; do
  node_modules/.bin/esbuild "scripts/$t.ts" --bundle --platform=node --format=cjs --outfile=".tmp/$t.cjs" --log-level=error
  echo "== $t"
  node ".tmp/$t.cjs" | tail -n 1
done
