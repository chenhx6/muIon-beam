# MVP smoke model

The fixture uses a μ− source and records one JSON object per scenario.

| Scenario | Purpose | Required evidence |
|---|---|---|
| `runtime` | verify build, initialization, tracking and basic scoring | Geant4 version, positive event/track count |
| `geometry` | verify clean navigation and detect a deliberate overlap | clean case has no overlap; intentional case reports overlap |
| `uniform-magnetic-field` | check units, field registration and tracking scale | 100 keV μ−, 1 T, trajectory radius within 5% of `p/(|q|B)` |
| `material` | check energy loss, scattering and material scoring | finite path/energy deposition/initial/final energy records |

The field test is a scale check, not a precision field-map validation. The
material test does not assert a research result; it asserts that the requested
observable is finite and physically interpretable. A missing native runtime is
reported as `not-yet-validated`.
