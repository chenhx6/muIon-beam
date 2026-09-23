# Level-1 Module Dataflow

The level-1 device uses file-based, manifest-bound coupling between modules.
Modules do not attach to each other's live processes or silently read mutable
working directories.

```text
SolidWorks SLDPRT
    -> STEP export + geometry hash
    -> COMSOL import-check / field solve
    -> frozen field or stopping result files + result Manifest + SHA256
    -> Geant4 input snapshot
    -> Geant4 score files + run Manifest + SHA256
    -> validation and reports
```

Rules:

- SLDPRT is the editable geometry source.
- STEP is the neutral geometry interface for COMSOL and Geant4.
- COMSOL produces explicit result files such as field exports, stopping tables,
  boundary summaries, and model metadata. Each file is registered with units,
  coordinate frame, producer version and SHA256.
- Geant4 consumes only a frozen input snapshot referenced by its run Manifest.
- Geant4 writes score and statistics files; COMSOL does not read them through a
  live link.
- Feedback from Geant4 to COMSOL is a new bounded task or campaign with a new
  contract and snapshot, never an implicit circular dependency.
- A result file is valid for downstream use only when its producer Manifest,
  units, coordinate frame, model fingerprint and hash are available.
