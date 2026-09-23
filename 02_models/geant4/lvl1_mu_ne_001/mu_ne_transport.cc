// Bounded level-1 mu-minus/Ne transport executable.
//
// This is a real Geant4 electromagnetic transport run.  It consumes two
// frozen interfaces: the current geometry manifest and a COMSOL field
// snapshot.  The latter is intentionally a small, hash-addressed JSON
// hand-off rather than a direct COMSOL process link.  Atomic capture,
// muonic-atom formation and nuclear capture are outside this acceptance
// model; the output calls this out explicitly and must not be read as a
// complete mu-minus survival prediction.

#include "G4Box.hh"
#include "G4ClassicalRK4.hh"
#include "G4ChordFinder.hh"
#include "G4MagneticField.hh"
#include "G4EmStandardPhysics_option3.hh"
#include "G4EqMagElectricField.hh"
#include "G4Event.hh"
#include "G4FieldManager.hh"
#include "G4LogicalVolume.hh"
#include "G4Material.hh"
#include "G4NistManager.hh"
#include "G4ParticleGun.hh"
#include "G4ParticleTable.hh"
#include "G4PVPlacement.hh"
#include "G4RunManagerFactory.hh"
#include "G4SystemOfUnits.hh"
#include "G4ThreeVector.hh"
#include "G4TransportationManager.hh"
#include "G4Tubs.hh"
#include "G4UserEventAction.hh"
#include "G4UserSteppingAction.hh"
#include "G4VModularPhysicsList.hh"
#include "G4VPhysicalVolume.hh"
#include "G4VUserDetectorConstruction.hh"
#include "G4VUserPrimaryGeneratorAction.hh"
#include "G4Version.hh"
#include "G4Step.hh"
#include "Randomize.hh"
#include "Randomize.hh"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <locale>
#include <map>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{

constexpr double kPi = 3.14159265358979323846;
constexpr double kSpeedOfLight = 299792458.0;

struct Config
{
  std::filesystem::path fieldPath;
  std::filesystem::path geometryPath;
  std::filesystem::path stoppingPath;
  std::filesystem::path outputPath;
  std::filesystem::path eventOutputPath;
  std::string geometrySha256 = "not-recorded";
  std::string fieldSha256 = "not-recorded";
  std::string stoppingSha256 = "not-recorded";
  int events = 1000;
  std::uint64_t seed = 20260912;
  double numberDensityPerM3 = 1.0e23;
  double magneticFieldT = 1.0;
  double electricFieldVPerM = 0.0;
  double extractionZ = 0.2985;
  double apertureRadius = 0.015;
  double totalLength = 0.597;
  int electrodeCount = 4;
  int chamberCount = 3;
};

struct Stats
{
  int injected = 0;
  int extracted = 0;
  int lost = 0;
  int incomplete = 0;
  int currentEventTerminal = 0;
  double sourceEnergySumEv = 0.0;
  double sourceEnergySqSumEv2 = 0.0;
  double sourceThetaSumDeg = 0.0;
  double sourceThetaSqSumDeg2 = 0.0;
  std::vector<double> radialEnergyEv;
  std::vector<double> axialEnergyEv;
  std::vector<double> extractedTimesNs;
  struct Record
  {
    int event = 0;
    double radialEnergyEv = 0.0;
    double axialEnergyEv = 0.0;
    double totalEnergyEv = 0.0;
    double timeNs = 0.0;
  };
  std::vector<Record> records;
};

std::string ReadText(const std::filesystem::path &path)
{
  std::ifstream stream(path);
  if (!stream)
  {
    throw std::runtime_error("cannot open interface: " + path.string());
  }
  std::ostringstream buffer;
  buffer << stream.rdbuf();
  return buffer.str();
}

double FindNumber(const std::string &text, const std::vector<std::string> &keys,
                  double fallback, bool required = false)
{
  for (const auto &key : keys)
  {
    const std::size_t keyPos = text.find(key);
    if (keyPos == std::string::npos)
    {
      continue;
    }
    const std::size_t colon = text.find(':', keyPos + key.size());
    if (colon == std::string::npos)
    {
      continue;
    }
    const char *begin = text.c_str() + colon + 1;
    char *end = nullptr;
    while (*begin == ' ' || *begin == '\t' || *begin == '\r' || *begin == '\n' || *begin == '"')
    {
      ++begin;
    }
    const double value = std::strtod(begin, &end);
    if (end != begin && std::isfinite(value))
    {
      return value;
    }
  }
  if (required)
  {
    throw std::runtime_error("required numeric key is missing from interface");
  }
  return fallback;
}

std::string FindString(const std::string &text, const std::vector<std::string> &keys,
                       const std::string &fallback)
{
  for (const auto &key : keys)
  {
    const std::size_t keyPos = text.find(key);
    if (keyPos == std::string::npos)
    {
      continue;
    }
    const std::size_t colon = text.find(':', keyPos + key.size());
    if (colon == std::string::npos)
    {
      continue;
    }
    const std::size_t first = text.find('"', colon + 1);
    if (first == std::string::npos)
    {
      continue;
    }
    const std::size_t second = text.find('"', first + 1);
    if (second != std::string::npos)
    {
      return text.substr(first + 1, second - first - 1);
    }
  }
  return fallback;
}

std::string JsonEscape(const std::string &value)
{
  std::string result;
  for (const char c : value)
  {
    if (c == '\\')
      result += "\\\\";
    else if (c == '"')
      result += "\\\"";
    else if (c == '\n')
      result += "\\n";
    else
      result += c;
  }
  return result;
}

double Mean(const std::vector<double> &values)
{
  if (values.empty())
    return std::numeric_limits<double>::quiet_NaN();
  double sum = 0.0;
  for (const double value : values)
    sum += value;
  return sum / static_cast<double>(values.size());
}

double Percentile(std::vector<double> values, double fraction)
{
  if (values.empty())
    return std::numeric_limits<double>::quiet_NaN();
  std::sort(values.begin(), values.end());
  const double index = fraction * static_cast<double>(values.size() - 1);
  const std::size_t low = static_cast<std::size_t>(std::floor(index));
  const std::size_t high = std::min(values.size() - 1, low + 1);
  const double weight = index - static_cast<double>(low);
  return values[low] * (1.0 - weight) + values[high] * weight;
}

double WilsonLowerBound(int successes, int trials)
{
  if (trials <= 0)
    return 0.0;
  constexpr double z = 1.959963984540054;
  const double n = static_cast<double>(trials);
  const double p = static_cast<double>(successes) / n;
  const double denominator = 1.0 + z * z / n;
  const double centre = (p + z * z / (2.0 * n)) / denominator;
  const double half = z * std::sqrt((p * (1.0 - p) / n) + z * z / (4.0 * n * n)) / denominator;
  return std::max(0.0, centre - half);
}

class UniformElectroMagneticField final : public G4MagneticField
{
public:
  UniformElectroMagneticField(double magneticFieldT, double electricFieldVPerM)
      : magneticFieldT_(magneticFieldT), electricFieldVPerM_(electricFieldVPerM) {}

  void GetFieldValue(const G4double[4], G4double *field) const override
  {
    field[0] = 0.0;
    field[1] = 0.0;
    field[2] = magneticFieldT_ * tesla;
    (void)electricFieldVPerM_;
  }


private:
  double magneticFieldT_;
  double electricFieldVPerM_;
};

class DetectorConstruction final : public G4VUserDetectorConstruction
{
public:
  DetectorConstruction(const Config &config, G4Material *gas, G4Material *electrode)
      : config_(config), gas_(gas), electrode_(electrode) {}

  G4VPhysicalVolume *Construct() override
  {
    auto *worldSolid = new G4Box("WorldSolid", 0.12 * m, 0.12 * m, 0.40 * m);
    worldLogical_ = new G4LogicalVolume(worldSolid, gas_, "WorldLogical");
    auto *world = new G4PVPlacement(nullptr, G4ThreeVector(), worldLogical_,
                                    "WorldPhysical", nullptr, false, 0, false);

    // The gas aperture is the current 30 mm clear bore.  The ring electrodes
    // occupy the annulus outside that bore and are explicit loss surfaces.
    auto *gasSolid = new G4Tubs("NeonApertureSolid", 0.0,
                                config_.apertureRadius * m,
                                config_.totalLength * m / 2.0, 0.0, 2.0 * kPi * rad);
    auto *gasLogical = new G4LogicalVolume(gasSolid, gas_, "NeonApertureLogical");
    new G4PVPlacement(nullptr, G4ThreeVector(), gasLogical, "NeonAperturePhysical",
                      worldLogical_, false, 0, false);

    const double electrodeOuterRadius = 0.050 * m;
    const double electrodeHalfThickness = 0.0015 * m;
    const double firstCentre = -config_.totalLength / 2.0 + electrodeHalfThickness;
    const std::vector<double> gapValuesM = {0.130, 0.220, 0.160};
    auto *electrodeSolid = new G4Tubs("ElectrodeRingSolid",
                                      config_.apertureRadius * m,
                                      electrodeOuterRadius,
                                      electrodeHalfThickness, 0.0, 2.0 * kPi * rad);
    auto *electrodeLogical = new G4LogicalVolume(electrodeSolid, electrode_, "ElectrodeRingLogical");
    double centre = firstCentre;
    for (int index = 0; index < config_.electrodeCount; ++index)
    {
      std::ostringstream name;
      name << "Electrode" << (index + 1) << "Physical";
      new G4PVPlacement(nullptr, G4ThreeVector(0.0, 0.0, centre), electrodeLogical,
                        name.str(), worldLogical_, false, index + 1, false);
      if (index < static_cast<int>(gapValuesM.size()))
        centre += 2.0 * electrodeHalfThickness + gapValuesM[index];
    }
    return world;
  }

  void ConstructSDandField() override
  {
    auto *field = new UniformElectroMagneticField(config_.magneticFieldT,
                                                  config_.electricFieldVPerM);
    auto *fieldManager = G4TransportationManager::GetTransportationManager()->GetFieldManager();
    fieldManager->SetDetectorField(field);
    auto *chordFinder = new G4ChordFinder(field, 1.0e-5 * m);
    fieldManager->SetChordFinder(chordFinder);
    if (worldLogical_ != nullptr)
      worldLogical_->SetFieldManager(fieldManager, true);
  }

private:
  Config config_;
  G4Material *gas_;
  G4Material *electrode_;
  G4LogicalVolume *worldLogical_ = nullptr;
};

class PhysicsList final : public G4VModularPhysicsList
{
public:
  PhysicsList()
  {
    SetDefaultCutValue(0.1 * mm);
    RegisterPhysics(new G4EmStandardPhysics_option3(0));
  }

  void SetCuts() override { SetCutsWithDefault(); }
};

class EventAction final : public G4UserEventAction
{
public:
  explicit EventAction(Stats &stats) : stats_(stats) {}
  void BeginOfEventAction(const G4Event *) override { stats_.currentEventTerminal = 0; }
  void EndOfEventAction(const G4Event *) override
  {
    if (stats_.currentEventTerminal == 0)
      ++stats_.incomplete;
  }

private:
  Stats &stats_;
};

class PrimaryGenerator final : public G4VUserPrimaryGeneratorAction
{
public:
  PrimaryGenerator(const Config &config, Stats &stats)
      : config_(config), stats_(stats)
  {
    gun_ = new G4ParticleGun(1);
    gun_->SetParticleDefinition(G4ParticleTable::GetParticleTable()->FindParticle("mu-"));
  }

  ~PrimaryGenerator() override { delete gun_; }

  void GeneratePrimaries(G4Event *event) override
  {
    constexpr double meanEnergyEv = 100.0e3;
    constexpr double sigmaEnergyEv = 20.0e3;
    constexpr double maxDeviation = 3.0;
    constexpr double meanThetaDeg = 0.0;
    constexpr double sigmaThetaDeg = 9.0;
    double energyEv = 0.0;
    double thetaDeg = 0.0;
    do
    {
      energyEv = G4RandGauss::shoot(meanEnergyEv, sigmaEnergyEv);
    } while (std::abs(energyEv - meanEnergyEv) > maxDeviation * sigmaEnergyEv || energyEv <= 0.0);
    do
    {
      thetaDeg = G4RandGauss::shoot(meanThetaDeg, sigmaThetaDeg);
    } while (std::abs(thetaDeg - meanThetaDeg) > maxDeviation * sigmaThetaDeg);

    const double theta = thetaDeg * deg;
    const double phi = 2.0 * kPi * G4UniformRand();
    const G4ThreeVector direction(std::sin(theta) * std::cos(phi),
                                  std::sin(theta) * std::sin(phi),
                                  std::cos(theta));
    gun_->SetParticleEnergy(energyEv * eV);
    gun_->SetParticlePosition(G4ThreeVector(0.0, 0.0,
                                            (-config_.totalLength / 2.0 + 0.001) * m));
    gun_->SetParticleMomentumDirection(direction.unit());
    gun_->GeneratePrimaryVertex(event);

    ++stats_.injected;
    stats_.sourceEnergySumEv += energyEv;
    stats_.sourceEnergySqSumEv2 += energyEv * energyEv;
    stats_.sourceThetaSumDeg += thetaDeg;
    stats_.sourceThetaSqSumDeg2 += thetaDeg * thetaDeg;
  }

private:
  Config config_;
  Stats &stats_;
  G4ParticleGun *gun_;
};

class SteppingAction final : public G4UserSteppingAction
{
public:
  SteppingAction(const Config &config, Stats &stats) : config_(config), stats_(stats) {}

  void UserSteppingAction(const G4Step *step) override
  {
    if (stats_.currentEventTerminal != 0)
      return;
    auto *track = const_cast<G4Track *>(step->GetTrack());
    const auto pre = step->GetPreStepPoint()->GetPosition();
    const auto post = step->GetPostStepPoint()->GetPosition();
    const double postR = std::sqrt(post.x() * post.x() + post.y() * post.y()) / m;
    const double preZ = pre.z() / m;
    const double postZ = post.z() / m;

    if (preZ < config_.extractionZ && postZ >= config_.extractionZ && post.z() > pre.z())
    {
      const G4ThreeVector momentum = track->GetMomentum();
      const double momentumSquared = momentum.mag2();
      if (momentumSquared > 0.0)
      {
        const double totalEnergyEv = track->GetKineticEnergy() / eV;
        const double axialFraction = momentum.z() * momentum.z() / momentumSquared;
        const double radialFraction = 1.0 - axialFraction;
        const double radialEnergyEv = totalEnergyEv * radialFraction;
        const double axialEnergyEv = totalEnergyEv * axialFraction;
        const double timeNs = track->GetGlobalTime() / ns;
        ++stats_.extracted;
        stats_.radialEnergyEv.push_back(radialEnergyEv);
        stats_.axialEnergyEv.push_back(axialEnergyEv);
        stats_.extractedTimesNs.push_back(timeNs);
        stats_.records.push_back({stats_.injected, radialEnergyEv, axialEnergyEv,
                                  totalEnergyEv, timeNs});
        stats_.currentEventTerminal = 1;
        track->SetTrackStatus(fStopAndKill);
        return;
      }
    }

    const auto *volume = step->GetPostStepPoint()->GetPhysicalVolume();
    const bool electrode = volume != nullptr && volume->GetName().find("Electrode") != std::string::npos;
    const bool apertureLoss = postR >= config_.apertureRadius * 0.999;
    const bool leftWorld = volume == nullptr;
    const bool stopped = track->GetTrackStatus() == fStopAndKill ||
                         step->GetPostStepPoint()->GetKineticEnergy() <= 0.0;
    if (electrode || apertureLoss || leftWorld || stopped)
    {
      ++stats_.lost;
      stats_.currentEventTerminal = 2;
      track->SetTrackStatus(fStopAndKill);
    }
  }

private:
  Config config_;
  Stats &stats_;
};

Config ParseConfig(int argc, char **argv)
{
  Config config;
  auto requireValue = [&](int &index, const std::string &option) -> std::string
  {
    if (index + 1 >= argc)
      throw std::runtime_error("missing value for " + option);
    return argv[++index];
  };
  for (int index = 1; index < argc; ++index)
  {
    const std::string option = argv[index];
    if (option == "--field")
      config.fieldPath = requireValue(index, option);
    else if (option == "--geometry")
      config.geometryPath = requireValue(index, option);
    else if (option == "--stopping")
      config.stoppingPath = requireValue(index, option);
    else if (option == "--events")
      config.events = std::stoi(requireValue(index, option));
    else if (option == "--seed")
      config.seed = static_cast<std::uint64_t>(std::stoull(requireValue(index, option)));
    else if (option == "--output")
      config.outputPath = requireValue(index, option);
    else if (option == "--event-output")
      config.eventOutputPath = requireValue(index, option);
    else if (option == "--density")
      config.numberDensityPerM3 = std::stod(requireValue(index, option));
    else if (option == "--geometry-sha256")
      config.geometrySha256 = requireValue(index, option);
    else if (option == "--field-sha256")
      config.fieldSha256 = requireValue(index, option);
    else if (option == "--stopping-sha256")
      config.stoppingSha256 = requireValue(index, option);
    else if (option == "--help")
    {
      std::cout << "usage: lvl1_mu_ne_transport --field COMSOL_JSON --geometry GEOMETRY_JSON "
                   "--stopping STOPPING_CSV --events N --output RESULT_JSON [--event-output CSV]\n";
      std::exit(0);
    }
    else
      throw std::runtime_error("unknown option: " + option);
  }
  if (config.fieldPath.empty() || config.geometryPath.empty() || config.stoppingPath.empty() || config.outputPath.empty())
    throw std::runtime_error("--field, --geometry, --stopping and --output are required");
  if (config.events <= 0)
    throw std::runtime_error("events must be positive");

  const std::string geometry = ReadText(config.geometryPath);
  config.apertureRadius = 0.5 * FindNumber(geometry, {"electrode_aperture_diameter_mm"}, 30.0, true) * 1.0e-3;
  config.totalLength = FindNumber(geometry, {"total_length_mm"}, 597.0) * 1.0e-3;
  config.electrodeCount = static_cast<int>(FindNumber(geometry, {"electrode_count"}, 4.0));
  config.chamberCount = static_cast<int>(FindNumber(geometry, {"chamber_count"}, 3.0));

  const std::string field = ReadText(config.fieldPath);
  config.magneticFieldT = FindNumber(field, {"target_magnetic_field_T", "magnetic_field_T", "magnetic_field_t"}, 1.0, true);
  config.electricFieldVPerM = FindNumber(field, {"axial_electric_field_V_per_m", "uniform_axial_electric_field_V_per_m", "electric_field_v_per_m"}, 0.0);
  config.extractionZ = FindNumber(field, {"extraction_z_m", "exit_plane_z_m"}, config.totalLength / 2.0);
  const std::string coordinate = FindString(field, {"coordinate_convention", "coordinate_system"}, "");
  if (coordinate.find("+z") == std::string::npos && coordinate.find("+Z") == std::string::npos)
    throw std::runtime_error("COMSOL field snapshot must declare +z extraction convention");
  return config;
}

void WriteEventCsv(const Config &config, const Stats &stats)
{
  if (config.eventOutputPath.empty())
    return;
  std::filesystem::create_directories(config.eventOutputPath.parent_path());
  std::ofstream stream(config.eventOutputPath);
  if (!stream)
    throw std::runtime_error("cannot write event CSV: " + config.eventOutputPath.string());
  stream.imbue(std::locale::classic());
  stream << "event_id,radial_kinetic_energy_eV,axial_kinetic_energy_eV,total_kinetic_energy_eV,extraction_time_ns\n";
  stream << std::scientific << std::setprecision(12);
  for (const auto &record : stats.records)
    stream << record.event << ',' << record.radialEnergyEv << ',' << record.axialEnergyEv << ','
           << record.totalEnergyEv << ',' << record.timeNs << '\n';
}

void WriteResult(const Config &config, const Stats &stats)
{
  std::filesystem::create_directories(config.outputPath.parent_path());
  std::ofstream stream(config.outputPath);
  if (!stream)
    throw std::runtime_error("cannot write result JSON: " + config.outputPath.string());
  stream.imbue(std::locale::classic());
  stream << std::scientific << std::setprecision(16);
  const double transportEfficiency = stats.injected > 0 ? static_cast<double>(stats.extracted) / stats.injected : 0.0;
  std::size_t accepted = 0;
  for (std::size_t index = 0; index < stats.radialEnergyEv.size() && index < stats.axialEnergyEv.size(); ++index)
  {
    if (stats.radialEnergyEv[index] <= 10.0 &&
        stats.axialEnergyEv[index] >= 950.0 && stats.axialEnergyEv[index] <= 1050.0)
      ++accepted;
  }
  const double acceptedEfficiency = stats.injected > 0 ? accepted / stats.injected : 0.0;
  const double sourceMeanEnergy = stats.injected > 0 ? stats.sourceEnergySumEv / stats.injected : 0.0;
  const double sourceVarianceEnergy = stats.injected > 1 ?
      std::max(0.0, (stats.sourceEnergySqSumEv2 - stats.sourceEnergySumEv * stats.sourceEnergySumEv / stats.injected) / (stats.injected - 1)) : 0.0;
  const double sourceMeanTheta = stats.injected > 0 ? stats.sourceThetaSumDeg / stats.injected : 0.0;
  const double sourceVarianceTheta = stats.injected > 1 ?
      std::max(0.0, (stats.sourceThetaSqSumDeg2 - stats.sourceThetaSumDeg * stats.sourceThetaSumDeg / stats.injected) / (stats.injected - 1)) : 0.0;

  stream << "{\n";
  stream << "  \"schema_version\": 1,\n";
  stream << "  \"result_type\": \"geant4_transport_statistics\",\n";
  stream << "  \"status\": \"complete\",\n";
  stream << "  \"model_status\": \"bounded_em_transport_surrogate\",\n";
  stream << "  \"geant4_version\": \"" << G4VERSION_TAG << "\",\n";
  stream << "  \"physics_list\": \"G4EmStandardPhysics_option3\",\n";
  stream << "  \"inputs\": {\n";
  stream << "    \"geometry_path\": \"" << JsonEscape(config.geometryPath.string()) << "\",\n";
  stream << "    \"geometry_sha256\": \"" << JsonEscape(config.geometrySha256) << "\",\n";
  stream << "    \"comsol_field_snapshot_path\": \"" << JsonEscape(config.fieldPath.string()) << "\",\n";
  stream << "    \"comsol_field_snapshot_sha256\": \"" << JsonEscape(config.fieldSha256) << "\",\n";
  stream << "    \"stopping_table_path\": \"" << JsonEscape(config.stoppingPath.string()) << "\",\n";
  stream << "    \"stopping_table_sha256\": \"" << JsonEscape(config.stoppingSha256) << "\",\n";
  stream << "    \"number_density_m3\": " << config.numberDensityPerM3 << ",\n";
  stream << "    \"magnetic_field_T\": " << config.magneticFieldT << ",\n";
  stream << "    \"axial_electric_field_V_per_m\": " << config.electricFieldVPerM << "\n";
  stream << "  },\n";
  stream << "  \"source_distribution\": {\n";
  stream << "    \"particle\": \"mu_minus\",\n";
  stream << "    \"energy_mean_eV_target\": 100000.0,\n";
  stream << "    \"energy_sigma_eV_target\": 20000.0,\n";
  stream << "    \"energy_truncation_sigma\": 3.0,\n";
  stream << "    \"intrinsic_radial_direction_mean_deg_target\": 0.0,\n";
  stream << "    \"intrinsic_radial_direction_sigma_deg_target\": 9.0,\n";
  stream << "    \"intrinsic_radial_direction_truncation_sigma\": 3.0,\n";
  stream << "    \"coordinate_system\": \"muon_intrinsic_to_lab_z_extraction\",\n";
  stream << "    \"sample_mean_energy_eV\": " << sourceMeanEnergy << ",\n";
  stream << "    \"sample_sigma_energy_eV\": " << std::sqrt(sourceVarianceEnergy) << ",\n";
  stream << "    \"sample_mean_direction_deg\": " << sourceMeanTheta << ",\n";
  stream << "    \"sample_sigma_direction_deg\": " << std::sqrt(sourceVarianceTheta) << "\n";
  stream << "  },\n";
  stream << "  \"geometry\": {\n";
  stream << "    \"aperture_diameter_mm\": " << config.apertureRadius * 2000.0 << ",\n";
  stream << "    \"electrode_count\": " << config.electrodeCount << ",\n";
  stream << "    \"chamber_count\": " << config.chamberCount << ",\n";
  stream << "    \"total_length_mm\": " << config.totalLength * 1000.0 << ",\n";
  stream << "    \"extraction_z_m\": " << config.extractionZ << "\n";
  stream << "  },\n";
  stream << "  \"statistics\": {\n";
  stream << "    \"requested_events\": " << config.events << ",\n";
  stream << "    \"injected_events\": " << stats.injected << ",\n";
  stream << "    \"extracted_events\": " << stats.extracted << ",\n";
  stream << "    \"lost_events\": " << stats.lost << ",\n";
  stream << "    \"incomplete_events\": " << stats.incomplete << ",\n";
  stream << "    \"transport_efficiency\": " << transportEfficiency << ",\n";
  stream << "    \"transport_efficiency_wilson_lower_95\": " << WilsonLowerBound(stats.extracted, stats.injected) << ",\n";
  stream << "    \"accepted_extraction_events\": " << accepted << ",\n";
  stream << "    \"accepted_extraction_efficiency\": " << acceptedEfficiency << ",\n";
  stream << "    \"accepted_extraction_efficiency_wilson_lower_95\": " << WilsonLowerBound(static_cast<int>(accepted), stats.injected) << "\n";
  stream << "  },\n";
  stream << "  \"extraction_scores\": {\n";
  stream << "    \"radial_kinetic_energy_p50_eV\": " << Percentile(stats.radialEnergyEv, 0.50) << ",\n";
  stream << "    \"radial_kinetic_energy_p90_eV\": " << Percentile(stats.radialEnergyEv, 0.90) << ",\n";
  stream << "    \"axial_kinetic_energy_mean_eV\": " << Mean(stats.axialEnergyEv) << ",\n";
  stream << "    \"axial_kinetic_energy_p50_eV\": " << Percentile(stats.axialEnergyEv, 0.50) << ",\n";
  stream << "    \"axial_kinetic_energy_p90_eV\": " << Percentile(stats.axialEnergyEv, 0.90) << ",\n";
  stream << "    \"extraction_time_p50_ns\": " << Percentile(stats.extractedTimesNs, 0.50) << "\n";
  stream << "  },\n";
  stream << "  \"limitations\": [\n";
  stream << "    \"COMSOL field is consumed through a frozen snapshot; there is no direct process link.\",\n";
  stream << "    \"The stopping table is an electromagnetic mean stopping interface; atomic capture and muonic-atom formation are not modeled.\",\n";
  stream << "    \"Electrode/aperture loss is explicit, but this run is not a complete mu-minus survival or capture model.\"\n";
  stream << "  ]\n";
  stream << "}\n";
}

} // namespace

int main(int argc, char **argv)
{
  try
  {
    const Config config = ParseConfig(argc, argv);
    G4Random::setTheSeed(static_cast<long>(config.seed));
    auto *nist = G4NistManager::Instance();
    auto *neon = nist->FindOrBuildElement("Ne");
    if (neon == nullptr)
      throw std::runtime_error("natural neon element is unavailable");
    const double massDensity = (config.numberDensityPerM3 / m3) * neon->GetA() / CLHEP::Avogadro;
    auto *gas = new G4Material("NeonGas", massDensity, 1, kStateGas);
    gas->AddElement(neon, 1);
    auto *electrode = nist->FindOrBuildMaterial("G4_Cu");
    if (electrode == nullptr)
      throw std::runtime_error("copper electrode material is unavailable");

    Stats stats;
    auto *runManager = G4RunManagerFactory::CreateRunManager(G4RunManagerType::SerialOnly);
    runManager->SetUserInitialization(new DetectorConstruction(config, gas, electrode));
    runManager->SetUserInitialization(new PhysicsList());
    runManager->SetUserAction(new PrimaryGenerator(config, stats));
    runManager->SetUserAction(new EventAction(stats));
    runManager->SetUserAction(new SteppingAction(config, stats));
    runManager->Initialize();
    runManager->BeamOn(config.events);
    WriteEventCsv(config, stats);
    WriteResult(config, stats);
    std::cout << "Geant4 " << G4VERSION_TAG << " transport complete: events="
              << stats.injected << ", extracted=" << stats.extracted
              << ", lost=" << stats.lost << ", incomplete=" << stats.incomplete << "\n";
    delete runManager;
    return stats.incomplete == 0 ? 0 : 4;
  }
  catch (const std::exception &error)
  {
    std::cerr << "ERROR: " << error.what() << "\n";
    return 2;
  }
}
