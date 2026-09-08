# Geant4 source priority

Permanent Geant4 facts should be checked against, in order:

1. the versioned Geant4 official documentation;
2. the versioned Geant4 source tree actually used by the run;
3. the matching official Geant4 example;
4. a project result that has been reproduced and regression-tested.

Third-party repositories may suggest an approach but are not sufficient
evidence for a stable physics rule. Every run records the Geant4 version,
physics constructor, data-set environment and relevant process names. A change
in any of those inputs creates a new evidence record; it does not silently
overwrite an earlier result.

Useful official references include the [Geant4 Physics Reference Manual energy
loss chapter](https://geant4.web.cern.ch/documentation/dev/prm_html/PhysicsReferenceManual/electromagnetic/energy_loss/enloss.html),
the [official electromagnetic field guide](https://geant4.web.cern.ch/documentation/dev/bfad_html/ForApplicationDevelopers/Detector/electroMagneticField.html),
and the [official overlap detection guide](https://geant4.web.cern.ch/documentation/dev/bfad_html/ForApplicationDevelopers/Detector/Geometry/geomOverlap.html).

These links are pointers to upstream authority, not copied documentation.
