# SolidWorks automation limitations and checkpoint notes

## 2026-09-05 unattended resume

- `scripts/BuildStage1SolidWorks.cs` was corrected and compiled successfully
  with the SolidWorks 2025 interop assembly (`x64`). The formal source now
  defines `ApertureFilletRadiusM = 1 mm`, uses the native `SketchFillet()` API,
  and applies the rounded annular profile to V1–V4 before the revolve.
- The isolated API probe
  `intermediate/SolidWorksSketchFilletTest.SLDPRT` already demonstrated that
  this native sketch-fillet route produces the expected rounded aperture
  topology before revolve (the inner circular edge radius changes from 15 mm
  at the profile center to 16 mm at the filleted axial ends).
- Earlier full-master retries failed before the builder printed
  `SOLIDWORKS_APP=CREATED`; the external attach probe returned RPC failure
  `0x800706BE`. This was recorded as a SolidWorks COM-instance/ROT limitation
  and did not affect any physics or scan result.
- The final corrected run succeeded after using a V1 conventional profile,
  inner-first profiles for V2–V4, and a V1–V3 checkpoint reopen. The canonical
  `cad/Stage1_Master_3D.SLDPRT` is now the updated six-body,
  three-configuration master. Final readback reports two 15 mm and two 16 mm
  aperture circles for every V1–V4 body, and the updated STEP import reports
  16 toroidal fillet surfaces across the electrodes.

## Re-entry action (completed)

The formal builder, validator, STEP exporter, and REPORT_3D preview exporter
have been rerun successfully from the project root. The reproducible commands
remain:

```text
stage1_3d_feasibility/scripts/BuildStage1SolidWorks.exe stage1_3d_feasibility
```

Then rerun `ValidateStage1SolidWorks.exe`, `ExportStage1SolidWorksStep.exe`,
and `ExportStage1SolidWorksPreview.exe` and update the geometry measurements in
`VALIDATION_CHECKLIST.md` if the model is intentionally regenerated. No
intermediate result or calculation-derived data should be deleted as part of a
future re-entry.
