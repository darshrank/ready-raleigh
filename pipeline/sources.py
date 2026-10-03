"""Provenance records. Every value shown to a player traces back to one of these (CLAUDE.md rule 2)."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Source:
    id: str  # short key used by per-value `source` references, e.g. "nc_bldg"
    dataset: str
    url: str
    date: str  # data vintage or fetch date (ISO)
    license: str
    method: str  # how we obtained / processed it

    def to_dict(self) -> dict:
        return asdict(self)
