"""python3 -m unittest deploy/vps/test_prune_own_cache.py (run in CI with the repo-safety job; no Docker needed)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from prune_own_cache import leaves_first, removable  # noqa: E402

HOUR = 3600


def record(record_id, parent=None, used="3 days ago", mutable=False, reclaimable=True):
    return {"ID": record_id, "Parents": [parent] if parent else None, "LastUsedAt": used, "Mutable": mutable,
            "Reclaimable": reclaimable, "Size": "1MB", "Description": f"[fontokmai] {record_id}"}


class Prune(unittest.TestCase):
    def test_an_old_chain_goes_with_the_mutable_layer_on_top_of_it(self):
        # a deploy of days ago: COPY src, then the layer its RUN left (mutable), which held the chain back
        records = [record("base"), record("src", "base"), record("run", "src", mutable=True)]
        gone = removable(records, 2 * HOUR)
        self.assertEqual({r["ID"] for r in gone}, {"base", "src", "run"})
        self.assertEqual([r["ID"] for r in leaves_first(gone)], ["run", "src", "base"])

    def test_what_the_latest_build_is_built_on_stays_however_old_it_looks(self):
        # a cache hit does not renew LastUsedAt: the apt layer looks hours old under today's build
        records = [record("apt", used="6 hours ago"), record("user", "apt", used="6 hours ago"),
                   record("venv", "user", used="8 minutes ago"), record("old-run", "user", mutable=True)]
        self.assertEqual({r["ID"] for r in removable(records, 2 * HOUR)}, {"old-run"})

    def test_a_record_held_by_a_build_or_an_image_stays_and_so_does_its_chain(self):
        records = [record("base"), record("held", "base", reclaimable=False)]
        self.assertEqual(removable(records, 2 * HOUR), [])

    def test_only_one_record_when_asked_and_only_if_nothing_is_built_on_it(self):
        records = [record("base"), record("leaf", "base")]
        self.assertEqual([r["ID"] for r in removable(records, 2 * HOUR, only="leaf")], ["leaf"])
        self.assertEqual(removable(records, 2 * HOUR, only="base"), [])


if __name__ == "__main__":
    unittest.main()
