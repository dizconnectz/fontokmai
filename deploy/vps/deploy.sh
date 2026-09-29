#!/usr/bin/env bash
# Deploy fontokmai on the VPS: pull, rebuild and restart the collector, then remove fontokmai's own old build cache
# and old images (prune_own_cache.py). Never prunes the images or the cache of other work on the machine.
# Not between 17:00 and 18:05 ICT, when other work on the machine runs (FORCE=1 to override).
# Usage: ~/fontokmai/app/deploy/vps/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
now=$(TZ=Asia/Bangkok date +%H%M)
if [ "$now" -ge 1700 ] && [ "$now" -lt 1805 ] && [ -z "${FORCE:-}" ]; then
  echo "17:00-18:05 ICT: other work on this machine runs now; deploy after 18:05 (or FORCE=1)" >&2
  exit 1
fi
git -C ../.. pull -q
git -C ../.. log --oneline -1
# the commit goes into the image, and from there into each line of the round archive
FONTOKMAI_CODE=$(git -C ../.. rev-parse --short=12 HEAD) docker compose up -d --build
python3 prune_own_cache.py
docker compose ps --format "{{.Service}} {{.Status}}"
