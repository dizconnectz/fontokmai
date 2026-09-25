#!/usr/bin/env bash
# Generate TypeScript types from the JSON Schemas of the public contract. Do not edit the output by hand.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p contracts/v1/ts
for name in alerts cctv manifest radar road_flood_history; do
  npx --yes -p json-schema-to-typescript@16.0.0 json2ts \
    --input "contracts/v1/schema/${name}.schema.json" \
    --output "contracts/v1/ts/${name}.ts" \
    --bannerComment "/* Generated from contracts/v1/schema/${name}.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */"
done
