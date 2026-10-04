"""A full rebuild keeps the map's detail sources in meta.json (needs pipeline/.venv)."""
import json
import tempfile
import unittest
from unittest import mock

from pipeline import build_all
from pipeline.tests.test_detail import REBUILT_META, fake_rebuild, no_network


class FullRebuildTests(unittest.TestCase):
    def test_meta_keeps_bus_stop_and_site_building_sources_after_a_rebuild(self):
        with tempfile.TemporaryDirectory() as root, mock.patch("urllib.request.urlopen", no_network):
            data, cache = fake_rebuild(root)
            steps = []

            def flood_stage():
                # Like build_flood: rewrites meta.json; whatever was there before is gone.
                steps.append("flood")
                (data / "meta.json").write_text(json.dumps(REBUILT_META))

            with mock.patch("pipeline.build_flood.main", flood_stage):
                build_all.finish(False, data, cache)
            meta = json.loads((data / "meta.json").read_text())
            self.assertEqual(steps, ["flood"])
            for key in ("busStops", "siteBuildings", "careHomes"):
                self.assertIn(key, meta["sources"], f"meta.json lost sources.{key} in a rebuild")
                self.assertIn(key, meta, f"meta.json lost its {key} block in a rebuild")

    def test_population_only_rebuild_also_refreshes_detail(self):
        with tempfile.TemporaryDirectory() as root, mock.patch("urllib.request.urlopen", no_network):
            data, cache = fake_rebuild(root)
            with mock.patch("pipeline.build_flood.main", side_effect=AssertionError("p2-only ran the flood")):
                build_all.finish(True, data, cache)
            meta = json.loads((data / "meta.json").read_text())
            self.assertIn("busStops", meta["sources"])
            self.assertIn("siteBuildings", meta["sources"])
            self.assertIn("careHomes", meta["sources"])


if __name__ == "__main__":
    unittest.main()
