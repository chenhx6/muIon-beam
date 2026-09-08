#include "G4Box.hh"
#include "G4DecayPhysics.hh"
#include "G4Event.hh"
#include "G4FieldManager.hh"
#include "G4LogicalVolume.hh"
#include "G4MagneticField.hh"
#include "G4Material.hh"
#include "G4MuonMinus.hh"
#include "G4PhysicalConstants.hh"
#include "G4NistManager.hh"
#include "G4ParticleGun.hh"
#include "G4ParticleTable.hh"
#include "G4PVPlacement.hh"
#include "G4RunManagerFactory.hh"
#include "G4Run.hh"
#include "G4SDManager.hh"
#include "G4Step.hh"
#include "G4StepLimiterPhysics.hh"
#include "G4SystemOfUnits.hh"
#include "G4ThreeVector.hh"
#include "G4TransportationManager.hh"
#include "G4UniformMagField.hh"
#include "G4UserLimits.hh"
#include "G4VModularPhysicsList.hh"
#include "G4VPhysicalVolume.hh"
#include "G4VUserDetectorConstruction.hh"
#include "G4VUserPrimaryGeneratorAction.hh"
#include "G4UserEventAction.hh"
#include "G4UserRunAction.hh"
#include "G4UserSteppingAction.hh"
#include "G4EmStandardPhysics_option3.hh"
#include "G4UnitsTable.hh"
#include "G4Version.hh"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct Config {
  std::string scenario = "runtime";
  std::string output = "g4-smoke.json";
  G4int events = 10;
  G4bool intentionalOverlap = false;
};

struct Results {
  G4int events = 0;
  G4int tracks = 0;
  G4double totalEdep = 0.;
  G4double primaryEdep = 0.;
  G4double pathLength = 0.;
  G4double initialEnergy = 0.;
  G4double finalEnergy = 0.;
  G4bool overlapDetected = false;
  G4bool navigationCompleted = false;
  G4int boundarySteps = 0;
  std::vector<G4ThreeVector> trajectory;
};

G4Material* Vacuum()
{
  return G4NistManager::Instance()->FindOrBuildMaterial("G4_Galactic");
}

G4Material* Silicon()
{
  return G4NistManager::Instance()->FindOrBuildMaterial("G4_Si");
}

class DetectorConstruction final : public G4VUserDetectorConstruction {
 public:
  explicit DetectorConstruction(const Config& config) : config_(config) {}

  G4VPhysicalVolume* Construct() override
  {
    auto* worldSolid = new G4Box("WorldSolid", 0.5 * m, 0.5 * m, 0.5 * m);
    worldLogical_ = new G4LogicalVolume(worldSolid, Vacuum(), "WorldLogical");
    worldLogical_->SetUserLimits(new G4UserLimits(config_.scenario == "uniform-magnetic-field" ? 0.5 * mm : 5. * mm));
    worldPhysical_ = new G4PVPlacement(nullptr, {}, worldLogical_, "WorldPhysical", nullptr, false, 0, false);

    if (config_.scenario == "material") {
      auto* slabSolid = new G4Box("MaterialSlabSolid", 0.02 * m, 0.02 * m, 0.5 * mm);
      auto* slabLogical = new G4LogicalVolume(slabSolid, Silicon(), "MaterialSlabLogical");
      new G4PVPlacement(nullptr, {}, slabLogical, "MaterialSlabPhysical", worldLogical_, false, 0, false);
    }

    if (config_.scenario == "geometry") {
      auto* boxSolid = new G4Box("OverlapSolid", 0.04 * m, 0.04 * m, 0.04 * m);
      auto* boxLogical = new G4LogicalVolume(boxSolid, Silicon(), "OverlapLogical");
      const G4ThreeVector first(-0.02 * m, 0., 0.);
      const G4ThreeVector second(config_.intentionalOverlap ? 0.02 * m : 0.10 * m, 0., 0.);
      placed_.push_back(new G4PVPlacement(nullptr, first, boxLogical, "BoxA", worldLogical_, false, 0, false));
      placed_.push_back(new G4PVPlacement(nullptr, second, boxLogical, "BoxB", worldLogical_, false, 1, false));
    }

    return worldPhysical_;
  }

  void CheckGeometry()
  {
    if (config_.scenario != "geometry") return;
    for (auto* volume : placed_) {
      overlapDetected_ = overlapDetected_ || volume->CheckOverlaps(2000, 0., false, 2);
    }
    navigationCompleted_ = true;
  }

  G4bool overlapDetected() const { return overlapDetected_; }
  G4bool navigationCompleted() const { return navigationCompleted_; }

 private:
  Config config_;
  G4LogicalVolume* worldLogical_ = nullptr;
  G4VPhysicalVolume* worldPhysical_ = nullptr;
  std::vector<G4VPhysicalVolume*> placed_;
  G4bool overlapDetected_ = false;
  G4bool navigationCompleted_ = false;
};

class PhysicsList final : public G4VModularPhysicsList {
 public:
  PhysicsList()
  {
    RegisterPhysics(new G4EmStandardPhysics_option3());
    RegisterPhysics(new G4DecayPhysics());
    RegisterPhysics(new G4StepLimiterPhysics());
  }
  void SetCuts() override { SetCutsWithDefault(); }
};

class PrimaryGenerator final : public G4VUserPrimaryGeneratorAction {
 public:
  explicit PrimaryGenerator(const Config& config)
  {
    gun_ = std::make_unique<G4ParticleGun>(1);
    auto* particle = G4MuonMinus::Definition();
    if (particle == nullptr) throw std::runtime_error("mu- particle definition is unavailable");
    gun_->SetParticleDefinition(particle);
    gun_->SetParticlePosition(config.scenario == "geometry" ? G4ThreeVector(-0.02 * m, 0., -0.2 * m) : G4ThreeVector(0., 0., -0.2 * m));
    gun_->SetParticleMomentumDirection({0., 0., 1.});
    gun_->SetParticleEnergy(config.scenario == "uniform-magnetic-field" ? 100. * keV : 1. * MeV);
    if (config.scenario == "uniform-magnetic-field") {
      gun_->SetParticlePosition({0., 0., 0.});
      gun_->SetParticleMomentumDirection({1., 0., 0.});
    }
  }
  void GeneratePrimaries(G4Event* event) override { gun_->GeneratePrimaryVertex(event); }

 private:
  std::unique_ptr<G4ParticleGun> gun_;
};

class RunAction final : public G4UserRunAction {
 public:
  explicit RunAction(Results& results) : results_(results) {}
  void BeginOfRunAction(const G4Run*) override { results_.events = 0; }
  void EndOfRunAction(const G4Run* run) override { results_.events = run ? run->GetNumberOfEvent() : results_.events; }

 private:
  Results& results_;
};

class EventAction final : public G4UserEventAction {
 public:
  explicit EventAction(Results& results) : results_(results) {}
  void BeginOfEventAction(const G4Event*) override { ++results_.events; }

 private:
  Results& results_;
};

class SteppingAction final : public G4UserSteppingAction {
 public:
  SteppingAction(const Config& config, Results& results) : config_(config), results_(results) {}
  void UserSteppingAction(const G4Step* step) override
  {
    if (step == nullptr) return;
    const auto* track = step->GetTrack();
    if (track == nullptr) return;
    results_.tracks = std::max(results_.tracks, track->GetTrackID());
    results_.totalEdep += step->GetTotalEnergyDeposit();
    results_.pathLength += step->GetStepLength();
    if (track->GetParentID() != 0) return;
    results_.primaryEdep += step->GetTotalEnergyDeposit();
    if (results_.initialEnergy == 0.) results_.initialEnergy = step->GetPreStepPoint()->GetKineticEnergy();
    results_.finalEnergy = step->GetPostStepPoint()->GetKineticEnergy();
    if (step->GetPostStepPoint()->GetStepStatus() == fGeomBoundary) ++results_.boundarySteps;
    if (config_.scenario == "uniform-magnetic-field" && results_.trajectory.size() < 5000) {
      results_.trajectory.push_back(track->GetPosition());
      if (track->GetTrackLength() >= 0.12 * m) step->GetTrack()->SetTrackStatus(fStopAndKill);
    }
  }

 private:
  Config config_;
  Results& results_;
};

void InstallField(const Config& config)
{
  if (config.scenario != "uniform-magnetic-field") return;
  auto* field = new G4UniformMagField(G4ThreeVector(0., 0., 1. * tesla));
  auto* manager = G4TransportationManager::GetTransportationManager()->GetFieldManager();
  manager->SetDetectorField(field);
  manager->CreateChordFinder(field);
}

void WriteJson(const Config& config, const Results& results)
{
  std::ofstream out(config.output);
  if (!out) throw std::runtime_error("cannot open output: " + config.output);
  out << std::setprecision(17);
  out << "{\n";
  out << "  \"scenario\": \"" << config.scenario << "\",\n";
#ifdef G4_MVP_GEANT4_VERSION
  out << "  \"geant4_version\": \"" << G4_MVP_GEANT4_VERSION << "\",\n";
#else
  out << "  \"geant4_version\": \"" << G4Version << "\",\n";
#endif
  out << "  \"particle\": \"mu-\",\n";
  out << "  \"physics_list\": \"G4EmStandardPhysics_option3 + G4DecayPhysics + G4StepLimiterPhysics\",\n";
  out << "  \"material\": \"" << (config.scenario == "material" ? "G4_Si" : "G4_Galactic") << "\",\n";
  out << "  \"magnetic_field_t\": " << (config.scenario == "uniform-magnetic-field" ? 1.0 : 0.0) << ",\n";
  out << "  \"events\": " << results.events << ",\n";
  out << "  \"statistical_uncertainty\": \"not-evaluated\",\n";
  out << "  \"needs_more_events\": \"not-evaluated\",\n";
  out << "  \"tracks\": " << results.tracks << ",\n";
  out << "  \"total_edep_j\": " << results.totalEdep / joule << ",\n";
  out << "  \"primary_edep_j\": " << results.primaryEdep / joule << ",\n";
  out << "  \"path_length_m\": " << results.pathLength / m << ",\n";
  out << "  \"boundary_steps\": " << results.boundarySteps << ",\n";
  out << "  \"initial_energy_ev\": " << results.initialEnergy / eV << ",\n";
  out << "  \"final_energy_ev\": " << results.finalEnergy / eV << ",\n";
  out << "  \"overlap_detected\": " << (results.overlapDetected ? "true" : "false") << ",\n";
  out << "  \"navigation_completed\": " << (results.navigationCompleted ? "true" : "false");
  if (config.scenario == "uniform-magnetic-field") {
    const auto* particle = G4ParticleTable::GetParticleTable()->FindParticle("mu-");
    const G4double kinetic = 100. * keV;
    const G4double massEnergy = particle->GetPDGMass();
    const G4double momentum = std::sqrt((kinetic + massEnergy) * (kinetic + massEnergy) - massEnergy * massEnergy) / c_light;
    const G4double analyticRadius = momentum / (eplus * tesla);
    G4double extent = 0.;
    for (const auto& point : results.trajectory) extent = std::max(extent, std::hypot(point.x(), point.y()));
    out << ",\n  \"trajectory_extent_m\": " << extent / m;
    out << ",\n  \"measured_radius_m\": " << (extent / 2.) / m;
    out << ",\n  \"analytic_larmor_radius_m\": " << analyticRadius / m;
  }
  out << "\n}\n";
}

Config Parse(int argc, char** argv)
{
  Config config;
  for (int i = 1; i < argc; ++i) {
    const std::string arg(argv[i]);
    auto value = [&](const char* name) -> std::string {
      if (i + 1 >= argc) throw std::runtime_error(std::string("missing value for ") + name);
      return argv[++i];
    };
    if (arg == "--scenario") config.scenario = value("--scenario");
    else if (arg == "--output") config.output = value("--output");
    else if (arg == "--events") config.events = std::stoi(value("--events"));
    else if (arg == "--intentional-overlap") config.intentionalOverlap = true;
    else if (arg == "--help") { std::cout << "g4_mvp_smoke --scenario runtime|geometry|uniform-magnetic-field|material --output FILE --events N [--intentional-overlap]\n"; std::exit(0); }
    else throw std::runtime_error("unknown argument: " + arg);
  }
  if (config.events < 1) throw std::runtime_error("events must be positive");
  if (config.scenario != "runtime" && config.scenario != "geometry" && config.scenario != "uniform-magnetic-field" && config.scenario != "material") throw std::runtime_error("unknown scenario: " + config.scenario);
  return config;
}

} // namespace

int main(int argc, char** argv)
{
  try {
    const Config config = Parse(argc, argv);
    Results results;
    auto* runManager = G4RunManagerFactory::CreateRunManager(G4RunManagerType::SerialOnly);
    auto* detector = new DetectorConstruction(config);
    runManager->SetUserInitialization(detector);
    runManager->SetUserInitialization(new PhysicsList());
    runManager->SetUserAction(new PrimaryGenerator(config));
    runManager->SetUserAction(new RunAction(results));
    runManager->SetUserAction(new EventAction(results));
    runManager->SetUserAction(new SteppingAction(config, results));
    InstallField(config);
    runManager->Initialize();
    detector->CheckGeometry();
    results.overlapDetected = detector->overlapDetected();
    results.navigationCompleted = detector->navigationCompleted();
    if (config.scenario != "geometry" || !config.intentionalOverlap) runManager->BeamOn(config.events);
    if (config.scenario == "geometry" && !config.intentionalOverlap) results.navigationCompleted = results.boundarySteps > 0;
    WriteJson(config, results);
    delete runManager;
    return config.scenario == "geometry" && config.intentionalOverlap && !results.overlapDetected ? 5 : 0;
  } catch (const std::exception& error) {
    std::cerr << "ERROR: " << error.what() << "\n";
    return 1;
  }
}
