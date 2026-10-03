import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import geopandas as gpd
import h3
from shapely.geometry import box, mapping

from pipeline.config import CACHE, DATA
from pipeline.geography import allocate_cells, parse_counts, split_counts
from pipeline.neighborhoods import name_cells
from pipeline.sources import VARIABLES, read_json
from pipeline.validate import validate_cells


def sample_cell():
    return {"i": 0, "h3": h3.latlng_to_cell(35.78, -78.64, 9), "hood": "Downtown",
            "pop": 100.0, "pop65": 10.0, "lowInc": 15.0, "noCarHH": 5.0,
            "floodStep": None, "cutOff": False, "heatC": 0, "treePct": 0}


class PipelineTests(unittest.TestCase):
    def test_age_poverty_and_tenure_sums(self):
        row = {v: "1" for ids in VARIABLES.values() for v in ids}
        self.assertEqual(parse_counts(row), {"pop": 1, "pop65": 12, "lowInc": 2, "noCarHH": 2})

    def test_census_missing_sentinel_is_not_population(self):
        row = {v: "1" for ids in VARIABLES.values() for v in ids}
        row["B01003_001E"] = "-666666666"
        with self.assertRaises(ValueError):
            parse_counts(row)

    def test_fractional_counts_are_preserved(self):
        self.assertAlmostEqual(split_counts({"pop": 100}, 3)["pop"] * 3, 100, places=5)
        with self.assertRaises(ValueError):
            split_counts({"pop": 100}, 0)

    def test_partial_block_group_does_not_import_outside_population(self):
        whole = box(-78.70, 35.75, -78.64, 35.81)
        clipped = box(-78.70, 35.75, -78.68, 35.81)
        area = gpd.GeoDataFrame({"kind": ["city", "buffer"]}, geometry=[clipped, clipped], crs=4326)
        groups = gpd.GeoDataFrame({"GEOID": ["371830001001"], "COUNTYFP": ["183"], "TRACTCE": ["000100"]}, geometry=[whole], crs=4326)
        row = {v: "1" for ids in VARIABLES.values() for v in ids}
        row.update({"B01003_001E": "900", "NAME": "Block Group 1; Census Tract 1; Wake County; North Carolina",
                    "state": "37", "county": "183", "tract": "000100", "block group": "1"})
        with tempfile.TemporaryDirectory() as temp, patch("pipeline.geography.CACHE", Path(temp)), patch("pipeline.geography.census_data", return_value=[row]):
            cells = allocate_cells({"acs_year": 2024}, area, groups)
        denominator = len(h3.geo_to_cells(mapping(whole), 9))
        self.assertLess(sum(c["pop"] for c in cells), 900)
        self.assertAlmostEqual(sum(c["pop"] for c in cells), 900 * len(cells) / denominator, places=3)
        self.assertEqual([c["i"] for c in cells], list(range(len(cells))))

    def test_durham_demographics_are_joined(self):
        whole = box(-78.70, 35.75, -78.64, 35.81)
        area = gpd.GeoDataFrame(geometry=[whole, whole], crs=4326)
        groups = gpd.GeoDataFrame({"GEOID": ["370630001001"], "COUNTYFP": ["063"], "TRACTCE": ["000100"]}, geometry=[whole], crs=4326)
        row = {v: "1" for ids in VARIABLES.values() for v in ids}
        row.update({"B01003_001E": "900", "NAME": "Block Group 1; Census Tract 1; Durham County",
                    "state": "37", "county": "063", "tract": "000100", "block group": "1"})
        with tempfile.TemporaryDirectory() as temp, patch("pipeline.geography.CACHE", Path(temp)), patch("pipeline.geography.census_data", return_value=[row]):
            cells = allocate_cells({"acs_year": 2024}, area, groups)
        self.assertTrue(all(c["acs_available"] and c["pop"] > 0 for c in cells))
        self.assertAlmostEqual(sum(c["pop"] for c in cells), 900, delta=.001)

    def test_neighborhood_fallback(self):
        cell = {**sample_cell(), "tract": "Census Tract 1"}
        names, report = name_cells([cell], {"elements": []})
        self.assertEqual(names[cell["h3"]], "Census Tract 1")
        self.assertEqual(report["fallback_cells"], 1)

    def test_nearest_osm_label(self):
        cell = {**sample_cell(), "tract": "Census Tract 1"}
        payload = {"elements": [
            {"type": "node", "id": 1, "lat": 35.78, "lon": -78.64, "tags": {"place": "neighbourhood", "name": "Near"}},
            {"type": "node", "id": 2, "lat": 36.0, "lon": -78.9, "tags": {"place": "suburb", "name": "Far"}}]}
        names, _ = name_cells([cell], payload)
        self.assertEqual(names[cell["h3"]], "Near")

    def test_cell_contract(self):
        validate_cells([sample_cell()])
        for field, value in [("pop", float("nan")), ("pop", -1), ("pop65", 101), ("i", True), ("hood", ""), ("floodStep", 4)]:
            with self.subTest(field=field, value=value):
                cell = {**sample_cell(), field: value}
                with self.assertRaises(ValueError):
                    validate_cells([cell])

    def test_duplicate_cells_rejected(self):
        cell = sample_cell()
        other = {**copy.deepcopy(cell), "i": 1}
        with self.assertRaises(ValueError):
            validate_cells([cell, other])

    @unittest.skipUnless((DATA / "cells.json").exists(), "Run the data build for artifact checks.")
    def test_generated_artifacts_and_allocation_conservation(self):
        cells = read_json(DATA / "cells.json")
        validate_cells(cells)
        self.assertLess((DATA / "cells.json").stat().st_size, 5_000_000)
        if (CACHE / "allocation_audit.json").exists():
            audit = read_json(CACHE / "allocation_audit.json")
            for field in VARIABLES:
                expected = sum(r["source_counts"][field] * r["study_cell_count"] / r["full_cell_count"] for r in audit if r["acs_available"])
                self.assertAlmostEqual(sum(c[field] for c in cells), expected, delta=.01)


if __name__ == "__main__":
    unittest.main()
