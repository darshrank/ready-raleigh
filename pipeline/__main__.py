"""CLI: python -m pipeline build <area> [--stage fetch,buildings,people,...]"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from . import PACK_VERSION
from .areas import list_areas, load_area
from .cache import FetchError

# Filled in milestone by milestone (BUILD.md). Order matters.
STAGES: list[str] = [
    "fetch", "buildings", "people", "flood", "damage", "roads", "validate", "rounds", "pack",
]  # fmt: skip


ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


def load_dotenv(path: Path = ENV_FILE) -> None:
    """Minimal .env reader (KEY=VALUE lines); real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def cmd_build(args: argparse.Namespace) -> int:
    area = load_area(args.area)
    stages = args.stage.split(",") if args.stage else STAGES
    unknown = [s for s in stages if s not in STAGES]
    if unknown:
        print(
            f"Unknown stage(s): {', '.join(unknown)}. Known: {', '.join(STAGES)}", file=sys.stderr
        )
        return 2
    from .stages import STAGES as IMPL

    print(f"[pipeline {PACK_VERSION}] area={area.id} ({area.name}) bbox={area.bbox}")
    for stage in stages:
        fn = IMPL.get(stage)
        if fn is None:
            print(f"  - {stage}: not implemented yet")
            continue
        print(f"  - {stage} …", flush=True)
        try:
            report = fn(area, refresh=args.refresh)
        except FetchError as e:
            print(f"    FAILED: {e}", file=sys.stderr)
            return 1
        print("    " + json.dumps(report, indent=2, default=str).replace("\n", "\n    "))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m pipeline")
    sub = parser.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build a location pack for an area")
    b.add_argument("area", help=f"area id ({', '.join(list_areas())})")
    b.add_argument("--stage", help="comma-separated subset of stages")
    b.add_argument(
        "--refresh", action="store_true", help="re-derive work files from the HTTP cache"
    )
    b.set_defaults(func=cmd_build)
    sub.add_parser("areas", help="list areas").set_defaults(
        func=lambda _a: print("\n".join(list_areas())) or 0
    )
    args = parser.parse_args(argv)
    load_dotenv()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
