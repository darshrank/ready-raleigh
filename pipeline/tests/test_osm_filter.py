from osmnx import _overpass

from pipeline.fetch.osm import parse_filter, way_passes

DRIVE = parse_filter(_overpass._get_network_filter("drive"))
WALK = parse_filter(_overpass._get_network_filter("walk"))


def test_drive_filter_matches_overpass_semantics():
    assert way_passes({"highway": "residential"}, DRIVE)
    assert way_passes({"highway": "primary", "oneway": "yes"}, DRIVE)
    assert not way_passes({"highway": "footway"}, DRIVE)
    assert not way_passes({"highway": "service", "service": "driveway"}, DRIVE)
    assert not way_passes({"highway": "residential", "access": "private"}, DRIVE)
    assert not way_passes({"building": "yes"}, DRIVE)  # ["highway"] is required


def test_walk_filter():
    assert way_passes({"highway": "footway"}, WALK)
    assert not way_passes({"highway": "motorway"}, WALK)
    assert not way_passes({"highway": "residential", "foot": "no"}, WALK)
