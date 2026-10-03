import pytest

from pipeline.__main__ import main
from pipeline.areas import load_area


def test_crabtree_area_loads():
    a = load_area("crabtree")
    assert a.id == "crabtree"
    assert a.county_fips == "37183"
    lon_min, lat_min, lon_max, lat_max = a.bbox
    assert lon_min < lon_max and lat_min < lat_max
    assert "ADRN7" in a.nwps_gauges


def test_unknown_area_errors():
    with pytest.raises(FileNotFoundError):
        load_area("atlantis")


def test_build_cli_runs(capsys):
    assert main(["build", "crabtree", "--stage", "fetch"]) == 0
    assert "area=crabtree" in capsys.readouterr().out


def test_build_cli_rejects_unknown_stage():
    assert main(["build", "crabtree", "--stage", "teleport"]) == 2
