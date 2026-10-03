"""Strict P2 Cell-contract checks, also used by the build and unit tests."""
import math
import h3

FIELDS = {"i", "h3", "hood", "pop", "pop65", "lowInc", "noCarHH", "floodStep", "cutOff", "heatC", "treePct"}


def validate_cells(cells):
    if not isinstance(cells, list) or not cells:
        raise ValueError("Expected a nonempty Cell array.")
    seen = set()
    for i, cell in enumerate(cells):
        if set(cell) != FIELDS:
            raise ValueError(f"Cell {i}: contract fields differ.")
        if type(cell["i"]) is not int or cell["i"] != i:
            raise ValueError(f"Cell {i}: index must equal its position.")
        if not h3.is_valid_cell(cell["h3"]) or h3.get_resolution(cell["h3"]) != 9 or cell["h3"] in seen:
            raise ValueError(f"Cell {i}: invalid, duplicate, or wrong-resolution H3 ID.")
        seen.add(cell["h3"])
        if not isinstance(cell["hood"], str) or not cell["hood"].strip():
            raise ValueError(f"Cell {i}: missing neighborhood name.")
        for field in ("pop", "pop65", "lowInc", "noCarHH", "heatC", "treePct"):
            value = cell[field]
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                raise ValueError(f"Cell {i}: invalid {field}.")
        if cell["pop65"] > cell["pop"] or cell["lowInc"] > cell["pop"]:
            raise ValueError(f"Cell {i}: demographic count exceeds population.")
        if cell["floodStep"] is not None or cell["cutOff"] is not False or cell["heatC"] != 0 or cell["treePct"] != 0:
            raise ValueError(f"Cell {i}: P2 placeholder values changed.")
