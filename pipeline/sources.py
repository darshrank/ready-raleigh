"""Cached source downloads. Completed files are immutable until explicitly removed."""
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from pathlib import Path
from zipfile import is_zipfile

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import CACHE, STATE

SESSION = requests.Session()
SESSION.headers["User-Agent"] = "ReadyRaleigh-P2/1.0 (educational geospatial analysis)"
SESSION.mount("https://", HTTPAdapter(max_retries=Retry(
    total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504]
)))


def read_json(path):
    return json.loads(Path(path).read_text())


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
    temp.replace(path)


def request(url, **kwargs):
    # Never include the request URL in errors: Census keys may be query parameters.
    try:
        response = SESSION.get(url, timeout=(20, 180), **kwargs)
    except requests.RequestException as exc:
        raise RuntimeError(f"Source request failed ({type(exc).__name__}); retry with network access.") from None
    if not response.ok:
        raise RuntimeError(f"Source returned HTTP {response.status_code}: {url.split('?')[0]}")
    return response


def cached_json(path, url, params=None):
    if path.exists():
        print(f"  cached: {path.name}", flush=True)
        return read_json(path)
    response = request(url, params=params)
    try:
        value = response.json()
    except ValueError:
        raise RuntimeError(f"Expected JSON from {url}; check Census API key/access or service availability.") from None
    if isinstance(value, dict) and ("error" in value or "remark" in value):
        raise RuntimeError(f"Source reported an incomplete/error response: {url}")
    write_json(path, value)
    return value


def discover_releases():
    path = CACHE / "releases.json"
    if path.exists():
        return read_json(path)
    listing = request("https://www2.census.gov/geo/tiger/").text
    years = sorted({int(y) for y in re.findall(r'TIGER(20\d{2})/', listing)}, reverse=True)
    tiger_year = None
    for year in years:
        # Only select a release with an actual North Carolina place archive.
        r = SESSION.head(f"https://www2.census.gov/geo/tiger/TIGER{year}/PLACE/tl_{year}_{STATE}_place.zip", timeout=30)
        if r.status_code == 200:
            tiger_year = year
            break
    if tiger_year is None:
        raise RuntimeError("No published North Carolina TIGER places release found.")
    acs_year = None
    for year in range(date.today().year, 2019, -1):
        url = f"https://api.census.gov/data/{year}/acs/acs5/groups/B01003.json"
        r = SESSION.get(url, timeout=30)
        if r.status_code in (404, 204):
            continue
        if r.status_code != 200:
            raise RuntimeError(f"ACS release discovery failed with HTTP {r.status_code}.")
        payload = r.json()
        if "B01003_001E" in payload.get("variables", {}):
            acs_year = year
            write_json(CACHE / f"acs_{year}_B01003_variables.json", payload)
            break
    if acs_year is None:
        raise RuntimeError("No ACS 5-year release found.")
    result = {"tiger_year": tiger_year, "acs_year": acs_year,
              "block_group_year": acs_year, "checked_at": datetime.now(timezone.utc).isoformat()}
    write_json(path, result)
    return result


def tiger_zip(year, layer):
    name = f"tl_{year}_{STATE}_{layer.lower()}.zip"
    path = CACHE / name
    if path.exists():
        if not is_zipfile(path):
            raise ValueError(f"Corrupt cached ZIP: {path}; remove and rerun.")
        return path
    url = f"https://www2.census.gov/geo/tiger/TIGER{year}/{layer.upper()}/{name}"
    print(f"  downloading: {name}", flush=True)
    response = request(url, stream=True)
    temporary = path.with_suffix(".tmp")
    with temporary.open("wb") as stream:
        for chunk in response.iter_content(1024 * 1024):
            stream.write(chunk)
    if not is_zipfile(temporary):
        raise ValueError(f"Download is not a valid TIGER ZIP: {url}")
    temporary.replace(path)
    return path


VARIABLES = {
    "pop": ["B01003_001E"],
    "pop65": [f"B01001_{i:03d}E" for i in (*range(20, 26), *range(44, 50))],
    "lowInc": ["C17002_002E", "C17002_003E"],
    "noCarHH": ["B25044_003E", "B25044_010E"],
}


def verify_variables(year):
    """Verify IDs AND semantic labels against the selected year's API variable lists."""
    groups = {}
    for group in ("B01003", "B01001", "C17002", "B25044"):
        url = f"https://api.census.gov/data/{year}/acs/acs5/groups/{group}.json"
        groups[group] = cached_json(CACHE / f"acs_{year}_{group}_variables.json", url)["variables"]
    labels = {}
    age_labels = {"65 and 66 years", "67 to 69 years", "70 to 74 years", "75 to 79 years", "80 to 84 years", "85 years and over"}
    for field, ids in VARIABLES.items():
        labels[field] = {}
        for variable in ids:
            metadata = groups[variable.split("_")[0]].get(variable)
            if not metadata or metadata.get("predicateType") != "int":
                raise ValueError(f"Missing/non-integer estimate variable: {variable}")
            label = metadata["label"]
            valid = {
                "pop": label.rstrip(":") == "Estimate!!Total",
                "pop65": label.split("!!")[-1].rstrip(":") in age_labels,
                "lowInc": label.split("!!")[-1].rstrip(":") in {"Under .50", ".50 to .99"},
                "noCarHH": "No vehicle available" in label,
            }[field]
            if not valid:
                raise ValueError(f"Unexpected Census definition for {variable}: {label}")
            if field == "pop65":
                expected_sex = "Male:" if int(variable[7:10]) < 26 else "Female:"
                if expected_sex not in label:
                    raise ValueError(f"Wrong sex subtotal: {variable}")
            if field == "noCarHH":
                tenure = "Owner occupied:" if variable == "B25044_003E" else "Renter occupied:"
                if tenure not in label:
                    raise ValueError(f"Wrong tenure subtotal: {variable}")
            labels[field][variable] = label
    verified_path = CACHE / "verified_variables.json"
    verified = {"year": year, "fields": labels}
    if not verified_path.exists():
        write_json(verified_path, verified)
    elif read_json(verified_path) != verified:
        raise ValueError("Verified-variable cache disagrees with source definitions; invalidate cached stages.")
    return labels


def census_data(year, geography="block group"):
    from .config import COUNTY, PLACE
    path = CACHE / f"acs_{year}_{'wake_durham_bg' if geography == 'block group' else 'raleigh_place'}.json"
    if path.exists():
        data = read_json(path)
        return [dict(zip(data[0], row, strict=True)) for row in data[1:]]
    if not os.environ.get("CENSUS_API_KEY"):
        return bulk_census_data(year, geography)
    ids = [v for variables in VARIABLES.values() for v in variables]
    params = {"get": ",".join(["NAME"] + ids), "for": "block group:*",
              "in": f"state:{STATE} county:183,063 tract:*"}
    if geography == "place":
        params = {"get": "NAME,B01003_001E", "for": f"place:{PLACE}", "in": f"state:{STATE}"}
    if os.environ.get("CENSUS_API_KEY"):
        params["key"] = os.environ["CENSUS_API_KEY"]
    data = cached_json(path, f"https://api.census.gov/data/{year}/acs/acs5", params)
    if not isinstance(data, list) or len(data) < 2:
        raise ValueError("Census returned no data rows.")
    return [dict(zip(data[0], row, strict=True)) for row in data[1:]]


def bulk_table(year, group):
    """Stream official nationwide table, caching Wake/Durham BG and Raleigh rows."""
    path = CACHE / f"acs_{year}_{group}_wake_durham_subset.json"
    if path.exists():
        return read_json(path)
    url = (f"https://www2.census.gov/programs-surveys/acs/summary_file/{year}/"
           f"table-based-SF/data/5YRData/acsdt5y{year}-{group.lower()}.dat")
    print(f"  streaming official bulk table: {group}", flush=True)
    variables = [v for ids in VARIABLES.values() for v in ids if v.startswith(group + "_")]
    with request(url, stream=True) as response:
        lines = response.iter_lines(chunk_size=1024 * 1024)
        header = next(lines).decode("utf-8-sig").split("|")
        # API B01003_001E corresponds to summary-file B01003_E001.
        columns = {v: header.index(v.split("_")[0] + "_E" + v.split("_")[1][:3]) for v in variables}
        selected = {}
        for raw in lines:
            if raw.startswith((b"1500000US37183", b"1500000US37063", b"1600000US3755000|")):
                row = raw.decode().split("|")
                selected[row[0]] = {v: row[index] for v, index in columns.items()}
    if not selected or "1600000US3755000" not in selected:
        raise ValueError(f"Bulk table missing expected geographies: {group}")
    result = {"url": url, "rows": selected, "retrieved_at": datetime.now(timezone.utc).isoformat()}
    write_json(path, result)
    return result


def bulk_census_data(year, geography):
    from .config import COUNTY, PLACE
    if geography == "place":
        data = bulk_table(year, "B01003")["rows"][f"1600000US{STATE}{PLACE}"]
        return [{"NAME": "Raleigh city, North Carolina", **data, "state": STATE, "place": PLACE}]
    groups = ("B01003", "B01001", "C17002", "B25044")
    with ThreadPoolExecutor(max_workers=4) as executor:
        tables = list(executor.map(lambda group: bulk_table(year, group), groups))
    geoids = sorted(g for g in tables[0]["rows"] if g.startswith(("1500000US37183", "1500000US37063")))
    if any({g for g in t["rows"] if g.startswith(("1500000US37183", "1500000US37063"))} != set(geoids) for t in tables):
        raise ValueError("Bulk table block-group geographies do not agree.")
    rows = []
    for geographic_id in geoids:
        geoid = geographic_id[9:]
        tract_code = geoid[5:11]
        tract = str(int(tract_code[:4])) + ("." + tract_code[4:] if tract_code[4:] != "00" else "")
        record = {"NAME": f"Block Group {geoid[-1]}; Census Tract {tract}; {('Wake' if geoid[2:5] == '183' else 'Durham')} County; North Carolina",
                  "state": STATE, "county": geoid[2:5], "tract": tract_code, "block group": geoid[-1]}
        for table in tables:
            record.update(table["rows"][geographic_id])
        rows.append(record)
    header = list(rows[0])
    write_json(CACHE / f"acs_{year}_wake_durham_bg.json", [header] + [[r[k] for k in header] for r in rows])
    write_json(CACHE / "acs_transport.json", {"method": "Census public table-based summary files",
               "reason": "Census API requires a key; bulk files provide the same estimates without authentication.",
               "sources": [t["url"] for t in tables]})
    return rows
