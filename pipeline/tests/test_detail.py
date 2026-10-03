"""Semantic-zoom data scripts (standard library only): python3 -m unittest pipeline.tests.test_detail"""
import io
import unittest
import zipfile

from pipeline.bus_stops import feed_info, read_stops


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


if __name__ == "__main__":
    unittest.main()
