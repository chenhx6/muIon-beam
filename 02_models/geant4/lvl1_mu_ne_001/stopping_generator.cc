#include "G4Box.hh"
#include "G4EmCalculator.hh"
#include "G4EmStandardPhysics_option3.hh"
#include "G4LogicalVolume.hh"
#include "G4Material.hh"
#include "G4MuonMinus.hh"
#include "G4NistManager.hh"
#include "G4PVPlacement.hh"
#include "G4RunManagerFactory.hh"
#include "G4SystemOfUnits.hh"
#include "G4VModularPhysicsList.hh"
#include "G4VUserDetectorConstruction.hh"
#include "G4Version.hh"
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>

class Detector final : public G4VUserDetectorConstruction {
 public:
  explicit Detector(G4Material* material) : material_(material) {}
  G4VPhysicalVolume* Construct() override {
    auto* solid = new G4Box("WorldSolid", 1.0*m, 1.0*m, 1.0*m);
    auto* logical = new G4LogicalVolume(solid, material_, "WorldLogical");
    return new G4PVPlacement(nullptr, {}, logical, "WorldPhysical", nullptr, false, 0, false);
  }
 private:
  G4Material* material_;
};

class Physics final : public G4VModularPhysicsList {
 public:
  Physics() { RegisterPhysics(new G4EmStandardPhysics_option3()); }
  void SetCuts() override { SetCutsWithDefault(); }
};

int main(int argc, char** argv) {
  const std::string output = argc > 1 ? argv[1] : "lvl1_mu_ne_stopping.csv";
  const double number_density = 1.0e23 / m3;
  const double atomic_mass = 20.1797 * g / mole;
  const double mass_density = number_density * atomic_mass / CLHEP::Avogadro;
  auto* neon = new G4Material("NaturalNeon", 10., atomic_mass, mass_density);
  auto* run = G4RunManagerFactory::CreateRunManager(G4RunManagerType::SerialOnly);
  run->SetUserInitialization(new Detector(neon));
  run->SetUserInitialization(new Physics());
  run->Initialize();
  auto* muon = G4MuonMinus::Definition();
  G4EmCalculator calculator;
  std::ofstream file(output);
  if (!file) return 2;
  file << "kinetic_energy_eV,dEdx_eV_per_m,number_density_m3,stopping_normalized_eV_m2,geant4_version,physics_list\n";
  file << std::setprecision(17);
  for (int i = 0; i < 241; ++i) {
    const double exponent = 1.0 + 5.0 * static_cast<double>(i) / 240.0;
    const double energy = std::pow(10.0, exponent) * eV;
    const double dedx = calculator.ComputeTotalDEDX(energy, muon, neon);
    const double dedx_ev_per_m = dedx / (eV/m);
    file << energy/eV << ',' << dedx_ev_per_m << ',' << number_density/(1.0/m3) << ','
         << dedx_ev_per_m / (number_density/(1.0/m3)) << ",11.2.2,option3\n";
  }
  delete run;
  std::cerr << "generated=" << output << " version=" << G4Version << "\n";
  return 0;
}
