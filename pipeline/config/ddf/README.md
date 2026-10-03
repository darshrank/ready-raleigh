# Depth–damage functions

`occtypes.json` is copied unmodified from USACE Hydrologic Engineering Center's
[go-consequences](https://github.com/USACE/go-consequences/blob/main/structures/occtypes.json)
(MIT, © 2020 Hydrologic Engineering Center — see `LICENSE.go-consequences`), fetched 2026-10-03.

We use the **structure / depth** component only. Depth is feet of water above the first floor.
- RES1 (single-family): USACE EGM 04-01 curves (Normal distributions → mean ± 1 sd range).
- All other classes: USACE Galveston District curves as packaged in HEC-FIA (also in the
  FEMA Hazus damage-function library); deterministic.
