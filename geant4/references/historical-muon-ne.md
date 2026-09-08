# Historical μ−–Ne reference

This note summarizes the read-only legacy evidence at
`D:\muIon\muIon_archive\muon-ion_beam\muon\ne\muon_ne_g4`. It is not a new
migration and is not a current formal run.

The recorded baseline used Geant4 11.3.2, `mu-`, natural Neon, a reference
number density of `1e22 1/m^3`, and `G4EmStandardPhysics_option3` over the
recorded low-energy to 1 MeV grid. The output was a mean electromagnetic
stopping-power interface for later COMSOL use; it was not a full device
transport simulation.

The legacy report also records limitations below the low-energy model's
validated scope: μ−–Ne elastic angular scattering, atomic capture, muonic atom
formation, capture probability, atomic cascades, injection geometry and a
detector model were not included. These remain limitations and must not be
promoted to Geant4 rules merely because the old output exists.

The current WSL smoke environment is Geant4 11.2.2. Any comparison with the
11.3.2 legacy output must therefore record the version difference explicitly.
