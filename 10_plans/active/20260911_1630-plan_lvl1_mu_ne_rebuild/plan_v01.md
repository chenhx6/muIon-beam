# Level-1 Mu-Ne Reconstruction Plan

## Objective

Rebuild the level-1 mu-Ne device study as a current-project task, while
implementing the lowercase ID and timestamped filename policy, durable plans,
the library-style catalog, the local full-text reference library, and evidence-
triggered external reference retrieval.

## Physical baseline

- Coil diameter: 100 mm; target magnetic field: 1 T.
- Neon at 300 K; number-density sweep: `1e19..1e26 m^-3`.
- Electrode aperture: 30 mm; the initial geometry is four electrodes and three chambers. Three electrodes and two chambers remain an alternative.
- Injected `mu_minus` kinetic energy: mean 100 keV, sigma 20 keV, 3-sigma truncation.
- Intrinsic-coordinate radial momentum direction: mean 0 degree, sigma 9 degree, 3-sigma truncation.

## Acceptance

The real instance validates both project workflow (folder architecture, naming,
and overall process) and research workflow (control, state, contracts, and
3D/COMSOL/Geant4 file interaction). Historical Stage-1 files are source records,
not the active model for this instance.

- Transport efficiency at extraction is at least 0.75.
- Radial kinetic energy at extraction is at most 10 eV.
- Axial kinetic energy at extraction is 1.00 keV +/- 0.05 keV.
- Report both transport efficiency and accepted-extraction efficiency.

## Execution order

1. Normalize active IDs and implement naming checks.
2. Build `09_catalog` and `10_plans` recovery paths.
3. Index `08_references` and build the local full-text library.
4. Evaluate and adopt reference-retrieval candidates with pinned provenance.
5. Create task, model, and run contracts for the level-1 device.
6. Route geometry through 3D, fields through COMSOL, and particle transport through Geant4.
7. Generate timestamped concise and detailed reports, figures, tables, and evidence.
8. Run physics review, ultraqa, archive and three-end audit.

The project does not delete `90_migration` in this plan. Deletion is a later
controlled task after acceptance and audit.
