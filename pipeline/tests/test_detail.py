"""Semantic-zoom data scripts (standard library only): python3 -m unittest pipeline.tests.test_detail"""
import io
import unittest
import zipfile

from pipeline.bus_stops import feed_info, read_stops
from pipeline.site_buildings import contains, join_rings, match_sites, polygons_of


def feed(stops_txt, info_txt=None):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("stops.txt", stops_txt)
        if info_txt:
            z.writestr("feed_info.txt", info_txt)
    return zipfile.ZipFile(io.BytesIO(buf.getvalue()))


HEADER = "stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station\n"


class BusStopTests(unittest.TestCase):
    def test_boarding_stops_only_rounded_and_sorted(self):
        z = feed(
            "﻿" + HEADER
            + '27,1284,"Wilmington St at Cabarrus St",,35.774700,-78.638345,,,,\n'
            + '19,1201,"Hillsborough St at Mayo St (EB)",,35.781524,-78.653343,,,0,\n'
            + 'S1,,"Station",,35.7752,-78.6380,,,1,\n'
        )
        self.assertEqual(
            read_stops(z),
            [
                {"id": "19", "name": "Hillsborough St at Mayo St (EB)", "lat": 35.78152, "lon": -78.65334},
                {"id": "27", "name": "Wilmington St at Cabarrus St", "lat": 35.7747, "lon": -78.63835},
            ],
        )

    def test_rejects_rows_that_are_not_real_stops(self):
        with self.assertRaises(ValueError):
            read_stops(feed(HEADER + '1,,"Null Island",,0,0,,,,\n'))
        with self.assertRaises(ValueError):
            read_stops(feed(HEADER + '1,,"A",,35.78,-78.64,,,,\n1,,"B",,35.79,-78.64,,,,\n'))

    def test_feed_info(self):
        z = feed(HEADER, "feed_publisher_name,feed_version\nGoRaleigh,S1000098\n")
        self.assertEqual(feed_info(z)["feed_version"], "S1000098")
        self.assertEqual(feed_info(feed(HEADER)), {})


def way(id, coords, **tags):
    return {"type": "way", "id": id, "tags": tags, "geometry": [{"lon": x, "lat": y} for x, y in coords]}


def square(x0, y0, size):
    return [(x0, y0), (x0 + size, y0), (x0 + size, y0 + size), (x0, y0 + size), (x0, y0)]


def site(id, lon, lat):
    return {"id": id, "name": id, "lon": lon, "lat": lat}


class SiteBuildingTests(unittest.TestCase):
    def test_rings_join_and_holes(self):
        rings = join_rings([[(0, 0), (4, 0), (4, 4)], [(0, 0), (0, 4), (4, 4)]])
        self.assertEqual(len(rings), 1)
        rel = {
            "type": "relation",
            "id": 1,
            "members": [
                {"type": "way", "role": "outer", "geometry": [{"lon": x, "lat": y} for x, y in square(0, 0, 4)]},
                {"type": "way", "role": "inner", "geometry": [{"lon": x, "lat": y} for x, y in square(1, 1, 2)]},
            ],
        }
        polys = polygons_of(rel)
        self.assertEqual(len(polys), 1)
        self.assertTrue(contains(polys, (0.5, 0.5)))
        self.assertFalse(contains(polys, (2, 2)))  # in the courtyard

    def test_rules(self):
        small = way(10, square(0, 0, 0.001), building="yes")
        big = way(11, square(0.01, 0.01, 0.002), building="school")
        other = way(12, square(0.0105, 0.0135, 0.0005), building="yes")
        campus = way(20, square(0.009, 0.009, 0.006), amenity="school")
        church = way(21, square(0.05, 0.05, 0.001), building="church", amenity="place_of_worship")
        sites = [
            site("osm-node-1", 0.0005, 0.0005),  # inside the small building
            site("osm-node-2", 0.5, 0.5),  # in a field: keeps its square
            site("osm-way-21", 0.0505, 0.0505),  # the site is a building
            site("osm-way-20", 0.0095, 0.0095),  # campus point on the lawn: largest building inside
        ]
        out = {m["id"]: m for m in match_sites(sites, [campus, church], [small, big, other, church])}
        self.assertEqual(sorted(out), ["osm-node-1", "osm-way-20", "osm-way-21"])
        self.assertEqual((out["osm-node-1"]["match"], out["osm-node-1"]["osm"]), ("contains", "way/10"))
        self.assertEqual((out["osm-way-21"]["match"], out["osm-way-21"]["osm"]), ("self", "way/21"))
        self.assertEqual((out["osm-way-20"]["match"], out["osm-way-20"]["osm"]), ("grounds", "way/11"))
        self.assertEqual(out["osm-node-1"]["polygons"][0][0][1], [0.001, 0.0])


if __name__ == "__main__":
    unittest.main()
