"""Shelter sites as real buildings (semantic zoom, S5).

Run from the repository root (standard library only, any Python 3.11+):

    python3 -m pipeline.site_buildings            # uses cached Overpass answers if there are any
    python3 -m pipeline.site_buildings --refresh  # asks Overpass again

For each site in app/public/data/sites.json, finds its OpenStreetMap building footprint:
- `contains`: the site is an OSM node; the building whose polygon contains it.
- `self`: the site is a way or relation that is itself a building.
- `grounds`: the site is grounds (a school campus, a church lot): the building that contains the
  site's point, else the largest building whose center lies inside the grounds.
A site with no such building is left out; the map keeps its square marker.

Writes app/public/data/site_buildings.json as `[{id, match, osm, polygons}]`, where `polygons` is
GeoJSON MultiPolygon coordinates at 5 decimals.
"""
import argparse
import json
import math
import os
import ssl
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from .config import CACHE, DATA, MAX_FILE_BYTES

OVERPASS = "https://overpass-api.de/api/interpreter"
# Overpass refuses requests without a User-Agent.
USER_AGENT = "ready-raleigh-pipeline/1.0 (WolfHacks 2026)"
SITES_CACHE = CACHE / "site_elements_overpass.json"
BUILDINGS_CACHE = CACHE / "site_nearby_buildings_overpass.json"
NODE_RADIUS_M = 40
GROUNDS_PAD_M = 30
GROUNDS_MAX_M = 900
M_PER_DEG = 111_320


def tls_context():
    """Certificate-checked TLS; python.org builds on macOS have no CA bundle, so use the system's."""
    context = ssl.create_default_context()
    if not context.get_ca_certs() and os.path.exists("/etc/ssl/cert.pem"):
        context = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
    return context


def overpass(query, cache, refresh=False):
    if cache.exists() and not refresh:
        return json.loads(cache.read_text())
    body = urllib.parse.urlencode({"data": query}).encode()
    request = urllib.request.Request(OVERPASS, data=body, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=600, context=tls_context()) as response:
        answer = json.loads(response.read())
    if answer.get("remark", "").lower().startswith(("runtime error", "error")):
        raise SystemExit(f"Overpass: {answer['remark']}")
    CACHE.mkdir(parents=True, exist_ok=True)
    tmp = cache.with_suffix(".tmp")
    tmp.write_text(json.dumps(answer))
    os.replace(tmp, cache)
    return answer


# ---------------------------------------------------------------------------------------------
# Geometry in lon/lat (small areas, so a local x scale of cos(latitude) is enough).

def ring_of(geometry):
    return [(p["lon"], p["lat"]) for p in geometry]


def join_rings(lines):
    """Closed rings from way segments that may each be part of a ring (multipolygon members)."""
    rings, open_lines = [], [list(l) for l in lines if len(l) >= 2]
    while open_lines:
        ring = open_lines.pop()
        while ring[0] != ring[-1]:
            for k, line in enumerate(open_lines):
                if line[0] == ring[-1]:
                    ring += line[1:]
                elif line[-1] == ring[-1]:
                    ring += line[::-1][1:]
                elif line[-1] == ring[0]:
                    ring = line[:-1] + ring
                elif line[0] == ring[0]:
                    ring = line[::-1][:-1] + ring
                else:
                    continue
                open_lines.pop(k)
                break
            else:
                break  # cannot close it: drop it
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


def polygons_of(element):
    """[[outer, *holes], ...] for a closed way or a multipolygon relation; [] otherwise."""
    if element["type"] == "way":
        ring = ring_of(element.get("geometry", []))
        return [[ring]] if len(ring) >= 4 and ring[0] == ring[-1] else []
    if element["type"] == "relation":
        members = [m for m in element.get("members", []) if m["type"] == "way" and m.get("geometry")]
        outers = join_rings(ring_of(m["geometry"]) for m in members if m.get("role", "outer") in ("outer", ""))
        inners = join_rings(ring_of(m["geometry"]) for m in members if m.get("role") == "inner")
        polys = [[o] for o in outers]
        for hole in inners:
            for poly in polys:
                if in_ring(hole[0], poly[0]):
                    poly.append(hole)
                    break
        return polys
    return []


def in_ring(pt, ring):
    x, y = pt
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def contains(polys, pt):
    return any(in_ring(pt, poly[0]) and not any(in_ring(pt, h) for h in poly[1:]) for poly in polys)


def area_m2(polys):
    total = 0.0
    for poly in polys:
        for k, ring in enumerate(poly):
            kx = M_PER_DEG * math.cos(math.radians(ring[0][1]))
            a = sum((x1 * y2 - x2 * y1) for (x1, y1), (x2, y2) in zip(ring, ring[1:])) / 2
            total += (-1 if k else 1) * abs(a) * kx * M_PER_DEG
    return total


def center(polys):
    ring = polys[0][0][:-1]
    return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))


def radius_m(polys, origin):
    kx = M_PER_DEG * math.cos(math.radians(origin[1]))
    return max(math.hypot((x - origin[0]) * kx, (y - origin[1]) * M_PER_DEG) for poly in polys for ring in poly for x, y in ring)


def rounded(polys):
    return [[[[round(x, 5), round(y, 5)] for x, y in ring] for ring in poly] for poly in polys]


# ---------------------------------------------------------------------------------------------

def is_building(tags):
    return tags.get("building", "no") not in ("no", "false", "0")


def osm_ref(site_id):
    kind, _, num = site_id.removeprefix("osm-").partition("-")
    return kind, int(num)


def match_sites(sites, elements, buildings):
    """Each site's building: {id, match, osm, polygons}. Pure: the Overpass answers come in."""
    by_ref = {(e["type"], e["id"]): e for e in elements}
    footprints = [(f"{b['type']}/{b['id']}", polygons_of(b)) for b in buildings if is_building(b.get("tags", {}))]
    footprints = [(ref, polys) for ref, polys in footprints if polys]
    out = []
    for site in sites:
        kind, num = osm_ref(site["id"])
        point = (site["lon"], site["lat"])
        element = by_ref.get((kind, num))
        own = polygons_of(element) if element and kind != "node" else []
        hits = sorted((area_m2(p), ref, p) for ref, p in footprints if contains(p, point))
        if kind == "node":
            found = ("contains", *hits[0][1:]) if hits else None
        elif element and own and is_building(element.get("tags", {})):
            found = ("self", f"{kind}/{num}", own)
        elif own:
            if hits:
                found = ("grounds", *hits[0][1:])
            else:
                inside = sorted((area_m2(p), ref, p) for ref, p in footprints if contains(own, center(p)))
                found = ("grounds", *inside[-1][1:]) if inside else None
        else:
            found = ("contains", *hits[0][1:]) if hits else None
        if found:
            match, ref, polys = found
            out.append({"id": site["id"], "match": match, "osm": ref, "polygons": rounded(polys)})
    return out


def queries(sites, elements):
    """The two Overpass queries. `out geom` (body verbosity) is needed: `out tags geom` drops a
    relation's members, so multipolygons would have no geometry."""
    ids = {"node": [], "way": [], "relation": []}
    for s in sites:
        kind, num = osm_ref(s["id"])
        ids[kind].append(num)
    first = "[out:json][timeout:300];(" + "".join(f"{k}(id:{','.join(map(str, v))});" for k, v in ids.items() if v) + ");out geom;"
    # Buildings near each site: within NODE_RADIUS_M of a point, or across the whole grounds.
    by_ref = {(e["type"], e["id"]): e for e in elements or []}
    clauses = []
    for s in sites:
        kind, num = osm_ref(s["id"])
        polys = polygons_of(by_ref[(kind, num)]) if (kind, num) in by_ref and kind != "node" else []
        r = NODE_RADIUS_M if not polys else min(GROUNDS_MAX_M, radius_m(polys, (s["lon"], s["lat"])) + GROUNDS_PAD_M)
        clauses.append(f"wr[building](around:{round(r)},{s['lat']},{s['lon']});")
    second = "[out:json][timeout:600];(" + "".join(clauses) + ");out geom;"
    return first, second


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--refresh", action="store_true", help="ask Overpass again")
    args = parser.parse_args()

    sites = json.loads((DATA / "sites.json").read_text())
    first, _ = queries(sites, None)
    elements = overpass(first, SITES_CACHE, args.refresh)["elements"]
    _, second = queries(sites, elements)
    buildings = overpass(second, BUILDINGS_CACHE, args.refresh)["elements"]

    matched = match_sites(sites, elements, buildings)
    body = json.dumps(matched, separators=(",", ":"), ensure_ascii=False).encode()
    if len(body) >= MAX_FILE_BYTES:
        raise SystemExit(f"site_buildings.json would be {len(body):,} bytes, over the {MAX_FILE_BYTES:,} budget.")
    out = DATA / "site_buildings.json"
    tmp = out.with_suffix(".tmp")
    tmp.write_bytes(body)
    os.replace(tmp, out)

    counts = {}
    for m in matched:
        counts[m["match"]] = counts.get(m["match"], 0) + 1
    by_kind = {}
    for s in sites:
        kind = osm_ref(s["id"])[0]
        by_kind.setdefault(kind, [0, 0])[0] += 1
    hit = {m["id"] for m in matched}
    for s in sites:
        if s["id"] in hit:
            by_kind[osm_ref(s["id"])[0]][1] += 1
    print(f"site_buildings.json: {len(matched)} of {len(sites)} sites matched, {len(body):,} bytes")
    print("  by rule: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    print("  by OSM type (matched/all): " + ", ".join(f"{k} {v[1]}/{v[0]}" for k, v in by_kind.items()))
    missing = [s for s in sites if s["id"] not in hit]
    print(f"  {len(missing)} keep their square: " + "; ".join(f"{s['name']} ({s['id']})" for s in missing[:12]) + (" ..." if len(missing) > 12 else ""))

    meta_path = DATA / "meta.json"
    meta = json.loads(meta_path.read_text())
    meta.setdefault("sources", {})["siteBuildings"] = "https://www.openstreetmap.org/copyright"
    meta["siteBuildings"] = {
        "source": "OpenStreetMap building footprints via the Overpass API (" + OVERPASS + ")",
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "file": "site_buildings.json",
        "sites": len(sites),
        "matched": len(matched),
        "byRule": counts,
        "rules": "contains: node inside a building; self: the site is a building; grounds: building at the site point, else the largest building inside the grounds",
    }
    tmp = meta_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(meta, separators=(",", ":"), ensure_ascii=False, allow_nan=False))
    os.replace(tmp, meta_path)


if __name__ == "__main__":
    main()
