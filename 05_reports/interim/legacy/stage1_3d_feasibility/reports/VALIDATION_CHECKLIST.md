# Stage1 3D acceptance checklist

- [PASS] required archive files: all present
- [PASS] scan master rows: 165 completed single-muon points
- [PASS] candidate rows: 0 legal exit-plane candidates
- [PASS] raw time-series finite: 167 non-empty files checked
- [PASS] COMSOL reload: 3-D model tree reloaded
- [PASS] COMSOL stopping function: intSN present
- [PASS] COMSOL studies: single + ensemble study nodes present
- [PASS] SolidWorks configurations: SIM_3D and REPORT_3D present
- [PASS] SolidWorks bodies: shell + liner + V1–V4
- [PASS] SolidWorks open status: master re-opened cleanly
- [PASS] SolidWorks native aperture rounding: V1–V4 each show two 15 mm and two 16 mm aperture circles
- [PASS] Updated STEP import: new rounded SolidWorks STEP imported into COMSOL

## Geometry measurements from SolidWorks body bounding boxes

- Grounded shell: x/y ±55 mm, z=0–597 mm; inner bore is the named 100 mm boundary.
- Dielectric liner: x/y ±50 mm, z=0–597 mm; gas-side radius is 45 mm, representative 5 mm radial liner.
- V1: z=25–28 mm; V2: z=158–161 mm; V3: z=381–384 mm; V4: z=544–547 mm.
- Each electrode body: x/y ±40 mm bounding radius, 3 mm axial thickness; annular aperture is 30 mm diameter in the source profile.
- SolidWorks native aperture topology: V1–V4 each report two 15 mm and two 16 mm circular aperture edges, corresponding to the 1 mm profile fillets at both axial ends; the updated STEP import reports 16 toroidal fillet surfaces across the four electrodes.

## Interpretation boundary

`candidate_parameter_sets.csv` is intentionally empty: all tested trajectories were classified as losses or timeout before the explicit exit plane. The zero candidate count is a result, not a missing-data placeholder. The COMSOL ensemble checkpoint is stored separately under `intermediate/results/ensemble_500ns/` and uses a fixed 25-particle grid.
