"""CLAUDE.md rule 5: no parcel IDs or owner fields in any pack output."""

import json
import re
import zlib
from pathlib import Path

import pytest

OUT = Path(__file__).resolve().parents[1] / "out"
FORBIDDEN_KEYS = re.compile(r'"(PID|PARCEL_?ID|PIN|OWNER\w*|OWN_?NAME\w*)"\s*:', re.I)


def pack_files():
    if not OUT.exists():
        return []
    return [
        p
        for p in OUT.glob("*/*")
        if p.is_file() and p.suffix in (".json", ".geojson", ".geojsonl", ".pmtiles")
    ]


def _pmtiles_text(path: Path) -> str:
    """Decompress every tile in a PMTiles v3 archive and return the concatenated bytes as text."""
    import struct

    data = path.read_bytes()
    assert data[:7] == b"PMTiles"
    (root_off, root_len, meta_off, meta_len, _, _, tile_off, tile_len) = struct.unpack_from(
        "<8Q", data, 8
    )
    tiles = data[tile_off : tile_off + tile_len]
    meta = zlib.decompress(data[meta_off : meta_off + meta_len], 16 + zlib.MAX_WBITS)
    # Tile data is a sequence of gzip members; decompress them all.
    texts = [meta.decode("utf-8", "replace")]
    d = zlib.decompressobj(16 + zlib.MAX_WBITS)
    buf = tiles
    while buf:
        texts.append(d.decompress(buf).decode("latin-1"))
        buf = d.unused_data
        d = zlib.decompressobj(16 + zlib.MAX_WBITS)
    return "\n".join(texts)


@pytest.mark.parametrize("path", pack_files(), ids=lambda p: f"{p.parent.name}/{p.name}")
def test_no_parcel_or_owner_fields(path):
    if path.suffix == ".pmtiles":
        text = _pmtiles_text(path)
        # MVT stores keys as plain strings in each layer's key table.
        for key in ("PID", "OWNER", "OWNNAME", "PARCEL_ID"):
            assert not re.search(rf"[\x00-\x20]{key}[\x00-\x20\x22]", text), f"{key} in {path}"
    else:
        text = path.read_text()
        assert not FORBIDDEN_KEYS.search(text), f"forbidden field in {path}"


def test_privacy_scan_found_outputs():
    if not OUT.exists() or not any(OUT.glob("*/buildings.*")):
        pytest.skip("no pack built yet")
    assert pack_files(), "expected pack outputs to scan"


def test_scanner_catches_pid():
    assert FORBIDDEN_KEYS.search(json.dumps({"PID": "0794-12"}))
    assert FORBIDDEN_KEYS.search(json.dumps({"OWNER_NAME": "x"}))
    assert not FORBIDDEN_KEYS.search(json.dumps({"BLDG_ID": "1"}))
