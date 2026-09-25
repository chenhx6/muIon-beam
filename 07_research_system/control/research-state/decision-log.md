# Decision Log

## 2026-09-12T12:51:49.779Z ctx_lvl1_mu_ne_rebuild_v03

COMSOL 6.4 batch adapter was compiled and invoked, but its Java external class was denied filesystem write permission by the COMSOL security policy. No field or transport result was accepted; resume after a user-approved COMSOL security/profile fix.

## 2026-09-12T17:52:39.791Z ctx_lvl1_mu_ne_rebuild_v03

Geant4 1000-event bounded electromagnetic run completed but failed all final acceptance metrics: transport efficiency Wilson lower 0.488, radial extraction P90 6452 eV, axial mean 62.6 keV. Stop before 10000 events because the point estimate is far outside all acceptance targets. COMSOL result is geometry gate only, so this is a diagnostic failure, not a validated scientific conclusion.
