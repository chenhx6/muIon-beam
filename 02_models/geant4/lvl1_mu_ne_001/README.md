# Current Level-1 Mu-Ne Geant4 lane

This source is a current-project reconstruction of the read-only historical
mu-minus/Ne calculation. It is compiled against the current WSL Geant4
runtime (11.2.2), emits `S_N(E)=(1/N)*dE/dx`, and performs density scaling
checks at `1e21`, `1e23`, and `1e25 m^-3`.

The historical source is not used as an active model. The current stopping
executable is `lvl1_mu_ne_stopping`; `lvl1_mu_ne_transport` is the bounded
Geant4 electromagnetic transport executable. It samples the specified
100 keV ± 20 keV and intrinsic direction 0° ± 9° distributions with a 3σ
cut, transports `mu-` through the 1 T field and the frozen COMSOL axial field
snapshot, and records extraction-plane scores for 1000/10000-event runs.

## Frozen COMSOL hand-off

Geant4 and COMSOL are coupled through a file interface, never through a live
process link. The field JSON must contain at least:

```json
{
  "schema_version": 1,
  "field_snapshot_id": "field_lvl1_mu_ne_001_v01",
  "status": "validated",
  "coordinate_convention": "+z is extraction direction",
  "target_magnetic_field_T": 1.0,
  "axial_electric_field_V_per_m": 0.0,
  "extraction_z_m": 0.2985,
  "geometry_sha256": "...",
  "source_solver": "comsol"
}
```

`target_magnetic_field_T`, `axial_electric_field_V_per_m`, and
`extraction_z_m` are the fields consumed by the executable. The manifest for
each transport run records the field snapshot SHA256 and the geometry and
stopping input SHA256 values. A missing or non-`+z` snapshot is a hard input
error; the executable does not silently substitute a COMSOL result.

The transport result is explicitly marked
`bounded_em_transport_surrogate`. It includes electromagnetic stopping and
Geant4 multiple scattering, explicit aperture/electrode losses, and the
requested source distributions. It does not include atomic capture, muonic
atom formation, nuclear capture, or a complete mu-minus survival model.
