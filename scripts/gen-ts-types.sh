#!/usr/bin/env bash
# Generate TypeScript types from the JSON Schemas of the public contract. Do not edit the output by hand.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p contracts/v1/ts
for name in alerts bkk_flooding bkk_news bkk_rain bkk_water boundaries canal_outlook canals cctv dams flood_freq flows forecast forecast_rivers live_floods manifest outlook overview places radar river_lines road_flood_history satellite weather_today; do
  npx --yes -p json-schema-to-typescript@16.0.0 json2ts \
    --input "contracts/v1/schema/${name}.schema.json" \
    --output "contracts/v1/ts/${name}.ts" \
    --bannerComment "/* Generated from contracts/v1/schema/${name}.schema.json by scripts/gen-ts-types.sh. Do not edit by hand. */"
done
