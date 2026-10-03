"""HTTP cache: every fetch is stored at pipeline/cache/<source>/<hash> with its URL and timestamp.

DATA.md rule: re-runs must work offline from the cache. A cached entry is reused forever
unless `refresh=True`; delete the folder to force a refetch.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import requests

CACHE_DIR = Path(os.environ.get("RR_CACHE_DIR", Path(__file__).parent / "cache"))
USER_AGENT = "ReadyRaleigh/0.1 (hackathon research game; github.com/ready-raleigh)"
# Query params that must never be written to the cache metadata.
SECRET_PARAMS = {"key", "access_token", "api_key"}


class FetchError(RuntimeError):
    """Endpoint failed or returned something other than what DATA.md says."""


@dataclass(frozen=True)
class Cached:
    path: Path
    url: str
    fetched_at: str  # ISO 8601 UTC
    from_cache: bool

    def json(self) -> Any:
        return json.loads(self.path.read_bytes())

    def text(self) -> str:
        return self.path.read_text()


def _key(method: str, url: str, params: dict | None, data: dict | str | None) -> str:
    public = {k: v for k, v in sorted((params or {}).items()) if k not in SECRET_PARAMS}
    blob = json.dumps([method, url, public, data], sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:24]


def fetch(
    source: str,
    url: str,
    *,
    params: dict | None = None,
    data: dict | str | None = None,
    method: str = "GET",
    suffix: str = "",
    refresh: bool = False,
    timeout: float = 120,
    retries: int = 3,
    stream: bool = False,
) -> Cached:
    """Fetch `url` once and cache the body. Returns the cached file path + provenance."""
    folder = CACHE_DIR / source
    folder.mkdir(parents=True, exist_ok=True)
    key = _key(method, url, params, data)
    body = folder / f"{key}{suffix}"
    meta = folder / f"{key}.meta.json"
    if body.exists() and meta.exists() and not refresh:
        m = json.loads(meta.read_text())
        return Cached(body, m["url"], m["fetched_at"], True)

    public_params = {k: v for k, v in (params or {}).items() if k not in SECRET_PARAMS}
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = requests.request(
                method,
                url,
                params=params,
                data=data,
                headers={"User-Agent": USER_AGENT},
                timeout=timeout,
                stream=stream,
                allow_redirects=False,
            )
            loc = r.headers.get("Location", "") if r.is_redirect else ""
            if "missing_key" in loc:
                raise FetchError(f"{url} requires an API key (redirect to {loc})")
            if "invalid_key" in loc:
                raise FetchError(
                    f"{url} rejected the API key as invalid (redirect to {loc}). New Census keys "
                    "must be activated via the link in the signup email."
                )
            if r.status_code in (429, 502, 503, 504):
                raise requests.HTTPError(f"{r.status_code} from {url}", response=r)
            if r.status_code != 200:
                raise FetchError(f"{url} returned HTTP {r.status_code}: {r.text[:300]}")
            tmp = body.with_suffix(body.suffix + ".part")
            with tmp.open("wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
            tmp.replace(body)
            fetched_at = datetime.now(UTC).isoformat(timespec="seconds")
            meta.write_text(
                json.dumps(
                    {
                        "url": url,
                        "method": method,
                        "params": public_params,
                        "fetched_at": fetched_at,
                        "status": r.status_code,
                        "bytes": body.stat().st_size,
                    },
                    indent=2,
                )
            )
            return Cached(body, url, fetched_at, False)
        except FetchError:
            raise
        except (requests.RequestException, OSError) as e:
            last = e
            time.sleep(2 * (attempt + 1) ** 2)
    raise FetchError(f"{url} failed after {retries} attempts: {last}")
