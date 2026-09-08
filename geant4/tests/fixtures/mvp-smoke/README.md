# Geant4 MVP smoke fixture

This is a small standalone Geant4 application used by the repository smoke
runner. It is not a device model and it does not produce a research result.

```text
runtime                 vacuum tracking and event scoring
geometry                clean geometry and intentional-overlap checks
uniform-magnetic-field  100 keV mu- in 1 T, compared with Larmor radius
material                1 MeV mu- through a thin silicon slab
```

The executable writes one JSON result per scenario. A native Geant4 runtime is
required; when it is unavailable the repository runner reports
`not-yet-validated` rather than fabricating values.
