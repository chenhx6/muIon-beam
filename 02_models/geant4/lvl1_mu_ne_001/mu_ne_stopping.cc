#include "G4Box.hh"
#include "G4EmCalculator.hh"
#include "G4EmParameters.hh"
#include "G4EmStandardPhysics_option3.hh"
#include "G4EmStandardPhysics_option4.hh"
#include "G4Element.hh"
#include "G4LogicalVolume.hh"
#include "G4Material.hh"
#include "G4MuonMinus.hh"
#include "G4NistManager.hh"
#include "G4PVPlacement.hh"
#include "G4ParticleDefinition.hh"
#include "G4PhysicalConstants.hh"
#include "G4ProcessManager.hh"
#include "G4RunManagerFactory.hh"
#include "G4SystemOfUnits.hh"
#include "G4ThreeVector.hh"
#include "G4VEmModel.hh"
#include "G4VEnergyLossProcess.hh"
#include "G4VModularPhysicsList.hh"
#include "G4VPhysicalVolume.hh"
#include "G4VProcess.hh"
#include "G4VUserDetectorConstruction.hh"
#include "G4Version.hh"

#include <algorithm>
#include <cmath>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <locale>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{

  constexpr double kReferenceNumberDensityPerM3 = 1.0e23;
  constexpr int kLogGridPoints = 251;
  constexpr double kDensityValidationTolerance = 1.0e-4;

  const std::vector<double> kAnchorEnergiesEv = {
      10.0, 20.0, 50.0, 100.0, 200.0, 500.0,
      1.0e3, 2.0e3, 5.0e3, 1.0e4, 2.0e4, 5.0e4,
      1.0e5, 2.0e5, 5.0e5, 1.0e6};

  struct DataRow
  {
    double energyEv = 0.0;
    double speedMs = 0.0;
    double dEdxEvPerM = 0.0;
    double stoppingCrossSectionEvM2 = 0.0;
    double dampingRatePerS = 0.0;
    double csdaRangeM = 0.0;
  };

  struct ModelInfo
  {
    int index = -1;
    std::string name;
    double lowEnergyEv = 0.0;
    double highEnergyEv = 0.0;
  };

  struct ModelSelectionInfo
  {
    double energyEv = 0.0;
    std::string name;
  };

  struct CrossCheckInfo
  {
    double energyEv = 0.0;
    double totalEvPerM = 0.0;
    double electronicEvPerM = 0.0;
    double tableEvPerM = 0.0;
    double tableRelativeToTotal = 0.0;
  };

  struct DensityValidationRow
  {
    double energyEv = 0.0;
    double targetNumberDensityPerM3 = 0.0;
    double actualNumberDensityPerM3 = 0.0;
    double dEdxEvPerM = 0.0;
    double stoppingCrossSectionEvM2 = 0.0;
    double dEdxRatioToReference = 0.0;
    double expectedRatioFromNumberDensity = 0.0;
    double stoppingCrossSectionRatioToReference = 0.0;
  };

  struct DensityValidationSummary
  {
    std::vector<DensityValidationRow> rows;
    double maxActualDensityRelativeError = 0.0;
    double maxDensLinearRelativeError = 0.0;
    double maxStoppingCrossSectionRelativeError = 0.0;
    bool passed = false;
  };

  std::string JsonEscape(const std::string &value)
  {
    std::string escaped;
    escaped.reserve(value.size() + 8);
    for (const unsigned char c : value)
    {
      switch (c)
      {
      case '"':
        escaped += "\\\"";
        break;
      case '\\':
        escaped += "\\\\";
        break;
      case '\b':
        escaped += "\\b";
        break;
      case '\f':
        escaped += "\\f";
        break;
      case '\n':
        escaped += "\\n";
        break;
      case '\r':
        escaped += "\\r";
        break;
      case '\t':
        escaped += "\\t";
        break;
      default:
        if (c < 0x20)
        {
          const char *hex = "0123456789abcdef";
          escaped += "\\u00";
          escaped += hex[(c >> 4) & 0x0f];
          escaped += hex[c & 0x0f];
        }
        else
        {
          escaped += static_cast<char>(c);
        }
      }
    }
    return escaped;
  }

  std::string G4StringToStd(const G4String &value)
  {
    return std::string(value.c_str());
  }

  std::string Geant4VersionString()
  {
    const int version = G4VERSION_NUMBER;
    const int major = version / 100;
    const int minor = (version / 10) % 10;
    const int patch = version % 10;
    return std::to_string(major) + "." + std::to_string(minor) + "." + std::to_string(patch);
  }

  std::string GenerationUtc()
  {
    const std::time_t now = std::time(nullptr);
    std::tm utc{};
#if defined(_WIN32)
    gmtime_s(&utc, &now);
#else
    gmtime_r(&now, &utc);
#endif
    std::ostringstream stream;
    stream << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
    return stream.str();
  }

  G4Material *BuildNeonMaterial(
      G4Element *neon, double numberDensityPerM3, const G4String &name)
  {
    // Geant4 needs mass density. The model input remains number density:
    // rho = n * A / N_A. Pressure is deliberately not a model input.
    const G4double numberDensityInternal = numberDensityPerM3 / m3;
    const G4double massDensity = numberDensityInternal * neon->GetA() / Avogadro;
    auto *material = new G4Material(name, massDensity, 1, kStateGas);
    material->AddElement(neon, 1);
    return material;
  }

  double ActualNumberDensityPerM3(const G4Material *material)
  {
    // GetTotNbOfAtomsPerVolume() is in Geant4 internal inverse-volume units.
    return material->GetTotNbOfAtomsPerVolume() * m3;
  }

  class DetectorConstruction final : public G4VUserDetectorConstruction
  {
  public:
    explicit DetectorConstruction(G4Material *material) : material_(material) {}

    G4VPhysicalVolume *Construct() override
    {
      auto *solid = new G4Box("NeonWorldSolid", 1.0 * m, 1.0 * m, 1.0 * m);
      auto *logical = new G4LogicalVolume(solid, material_, "NeonWorldLogical");
      return new G4PVPlacement(
          nullptr, G4ThreeVector(), logical, "NeonWorldPhysical",
          nullptr, false, 0, false);
    }

  private:
    G4Material *material_;
  };

  class MinimalPhysicsList final : public G4VModularPhysicsList
  {
  public:
    explicit MinimalPhysicsList(bool useOption4)
    {
      SetDefaultCutValue(1.0 * mm);
      if (useOption4)
      {
        RegisterPhysics(new G4EmStandardPhysics_option4(0));
      }
      else
      {
        RegisterPhysics(new G4EmStandardPhysics_option3(0));
      }
    }

    void SetCuts() override
    {
      SetCutsWithDefault();
    }
  };

  std::vector<double> BuildEnergyGrid()
  {
    constexpr double minimumEv = 10.0;
    constexpr double maximumEv = 1.0e6;
    std::vector<double> energies;
    energies.reserve(300);

    const double logMinimum = std::log(minimumEv);
    const double logMaximum = std::log(maximumEv);
    for (int i = 0; i < kLogGridPoints; ++i)
    {
      const double fraction = static_cast<double>(i) / (kLogGridPoints - 1);
      energies.push_back(std::exp(logMinimum + fraction * (logMaximum - logMinimum)));
    }
    energies.insert(energies.end(), kAnchorEnergiesEv.begin(), kAnchorEnergiesEv.end());
    std::sort(energies.begin(), energies.end());

    std::vector<double> unique;
    unique.reserve(energies.size());
    for (const double energy : energies)
    {
      if (unique.empty())
      {
        unique.push_back(energy);
        continue;
      }
      const double previous = unique.back();
      const double scale = std::max(1.0, std::max(std::abs(previous), std::abs(energy)));
      if (std::abs(energy - previous) > 1.0e-10 * scale)
      {
        unique.push_back(energy);
      }
    }
    return unique;
  }

  double MuonMassKg(const G4ParticleDefinition *muon)
  {
    return (muon->GetPDGMass() / c_squared) / kg;
  }

  double MuonSpeedMs(const G4ParticleDefinition *muon, double energyEv)
  {
    const G4double kineticEnergy = energyEv * eV;
    const G4double massEnergy = muon->GetPDGMass();
    const G4double momentum =
        std::sqrt(kineticEnergy * (kineticEnergy + 2.0 * massEnergy));
    const G4double beta = momentum / (kineticEnergy + massEnergy);
    return beta * c_light / (m / s);
  }

  double DampingRatePerS(double dEdxInternal, double speedMs, double massKg)
  {
    const double dEdxJPerM = dEdxInternal / (joule / m);
    return dEdxJPerM / (massKg * speedMs);
  }

  std::vector<DataRow> ComputeRows(
      const std::vector<double> &energiesEv,
      G4EmCalculator &calculator,
      const G4ParticleDefinition *muon,
      const G4Material *material,
      double numberDensityPerM3)
  {
    const double massKg = MuonMassKg(muon);
    std::vector<DataRow> rows;
    rows.reserve(energiesEv.size());

    for (const double energyEv : energiesEv)
    {
      const G4double kineticEnergy = energyEv * eV;
      const G4double totalDedx =
          calculator.ComputeTotalDEDX(kineticEnergy, muon, material);
      const G4double csdaRange =
          calculator.GetCSDARange(kineticEnergy, muon, material);

      DataRow row;
      row.energyEv = energyEv;
      row.speedMs = MuonSpeedMs(muon, energyEv);
      row.dEdxEvPerM = totalDedx / (eV / m);
      row.stoppingCrossSectionEvM2 = row.dEdxEvPerM / numberDensityPerM3;
      row.dampingRatePerS =
          DampingRatePerS(totalDedx, row.speedMs, massKg);
      row.csdaRangeM = csdaRange / m;
      rows.push_back(row);
    }
    return rows;
  }

  G4VEnergyLossProcess *FindMuonIonisationProcess(
      const G4ParticleDefinition *muon)
  {
    auto *manager = muon->GetProcessManager();
    if (manager == nullptr)
    {
      return nullptr;
    }
    G4VProcess *process = manager->GetProcess("muIoni");
    return dynamic_cast<G4VEnergyLossProcess *>(process);
  }

  std::vector<ModelInfo> CollectModelInfo(
      const G4VEnergyLossProcess *process)
  {
    std::vector<ModelInfo> models;
    if (process == nullptr)
    {
      return models;
    }
    const std::size_t count = process->NumberOfModels();
    models.reserve(count);
    for (std::size_t i = 0; i < count; ++i)
    {
      G4VEmModel *model = process->EmModel(i);
      if (model == nullptr)
      {
        model = process->GetModelByIndex(i);
      }
      if (model == nullptr)
      {
        continue;
      }
      models.push_back({static_cast<int>(i),
                        G4StringToStd(model->GetName()),
                        model->LowEnergyLimit() / eV,
                        model->HighEnergyLimit() / eV});
    }
    return models;
  }

  std::vector<ModelSelectionInfo> CollectRuntimeModelSelections(
      const std::vector<ModelInfo> &models, double minimumEnergyEv)
  {
    std::vector<ModelSelectionInfo> selections;
    const std::vector<double> probeEnergies = {
        10.0, 100.0, 199999.0, 200000.0, 200001.0, 1.0e6};
    for (const double energyEv : probeEnergies)
    {
      if (energyEv + 1.0e-9 < minimumEnergyEv)
      {
        continue;
      }
      for (const auto &model : models)
      {
        if (energyEv >= model.lowEnergyEv && energyEv <= model.highEnergyEv)
        {
          selections.push_back({energyEv, model.name});
          break;
        }
      }
    }
    return selections;
  }

  std::vector<CrossCheckInfo> ComputeCrossChecks(
      G4EmCalculator &calculator,
      const G4ParticleDefinition *muon,
      const G4Material *material,
      double minimumEnergyEv)
  {
    std::vector<CrossCheckInfo> checks;
    for (const double energyEv : {1000.0, 10000.0, 100000.0})
    {
      if (energyEv + 1.0e-9 < minimumEnergyEv)
      {
        continue;
      }
      const G4double energy = energyEv * eV;
      const G4double total =
          calculator.ComputeTotalDEDX(energy, muon, material);
      const G4double electronic =
          calculator.ComputeElectronicDEDX(energy, muon, material);
      const G4double table = calculator.GetDEDX(energy, muon, material);
      checks.push_back({energyEv,
                        total / (eV / m),
                        electronic / (eV / m),
                        table / (eV / m),
                        total != 0.0 ? table / total - 1.0 : 0.0});
    }
    return checks;
  }

  DensityValidationSummary ComputeDensityValidation(
      G4EmCalculator &calculator,
      const G4ParticleDefinition *muon,
      const std::vector<double> &targetDensitiesPerM3,
      const std::vector<G4Material *> &materials,
      G4Material *referenceMaterial)
  {
    DensityValidationSummary summary;
    const std::vector<double> validationEnergiesEv =
        {1000.0, 10000.0, 100000.0};
    const double referenceActualDensity =
        ActualNumberDensityPerM3(referenceMaterial);

    for (const double energyEv : validationEnergiesEv)
    {
      const G4double energy = energyEv * eV;
      const double referenceDedx =
          calculator.ComputeTotalDEDX(energy, muon, referenceMaterial) / (eV / m);
      const double referenceStoppingCrossSection =
          referenceDedx / referenceActualDensity;

      for (std::size_t i = 0; i < materials.size(); ++i)
      {
        const double actualDensity = ActualNumberDensityPerM3(materials[i]);
        const double dedx =
            calculator.ComputeTotalDEDX(energy, muon, materials[i]) / (eV / m);
        const double stoppingCrossSection = dedx / actualDensity;
        const double densityRatio = actualDensity / referenceActualDensity;
        const double dedxRatio = dedx / referenceDedx;
        const double densityRelativeError =
            std::abs(actualDensity / targetDensitiesPerM3[i] - 1.0);
        const double dedxLinearityError =
            std::abs(dedxRatio / densityRatio - 1.0);
        const double stoppingCrossSectionError =
            std::abs(stoppingCrossSection / referenceStoppingCrossSection - 1.0);

        if (!std::isfinite(actualDensity) || !std::isfinite(dedx) || !std::isfinite(stoppingCrossSection) || !std::isfinite(densityRelativeError) || !std::isfinite(dedxLinearityError) || !std::isfinite(stoppingCrossSectionError))
        {
          throw std::runtime_error("non-finite density scaling result");
        }

        summary.maxActualDensityRelativeError =
            std::max(summary.maxActualDensityRelativeError, densityRelativeError);
        summary.maxDensLinearRelativeError =
            std::max(summary.maxDensLinearRelativeError, dedxLinearityError);
        summary.maxStoppingCrossSectionRelativeError =
            std::max(summary.maxStoppingCrossSectionRelativeError,
                     stoppingCrossSectionError);

        summary.rows.push_back({energyEv, targetDensitiesPerM3[i], actualDensity, dedx,
                                stoppingCrossSection, dedxRatio, densityRatio,
                                stoppingCrossSection / referenceStoppingCrossSection});
      }
    }

    summary.passed =
        summary.maxActualDensityRelativeError <= kDensityValidationTolerance && summary.maxDensLinearRelativeError <= kDensityValidationTolerance && summary.maxStoppingCrossSectionRelativeError <= kDensityValidationTolerance;
    return summary;
  }

  void ConfigureClassic(std::ofstream &stream)
  {
    stream.imbue(std::locale::classic());
    stream << std::scientific << std::setprecision(12);
  }

  void WriteMasterCsv(
      const std::filesystem::path &path, const std::vector<DataRow> &rows)
  {
    std::ofstream stream(path);
    if (!stream)
    {
      throw std::runtime_error("cannot open master CSV: " + path.string());
    }
    ConfigureClassic(stream);
    stream << "E_eV,v_m_s,dEdx_ref_eV_per_m,SN_eV_m2,nu_ref_s-1,CSDA_range_ref_m\n";
    for (const DataRow &row : rows)
    {
      stream << row.energyEv << "," << row.speedMs << ","
             << row.dEdxEvPerM << "," << row.stoppingCrossSectionEvM2 << ","
             << row.dampingRatePerS << "," << row.csdaRangeM << "\n";
    }
  }

  void WriteSNFile(
      const std::filesystem::path &path, const std::vector<DataRow> &rows)
  {
    std::ofstream stream(path);
    if (!stream)
    {
      throw std::runtime_error("cannot open SN output: " + path.string());
    }
    ConfigureClassic(stream);
    for (const DataRow &row : rows)
    {
      stream << row.energyEv << " " << row.stoppingCrossSectionEvM2 << "\n";
    }
  }

  void WriteNuFile(
      const std::filesystem::path &path, const std::vector<DataRow> &rows)
  {
    std::ofstream stream(path);
    if (!stream)
    {
      throw std::runtime_error("cannot open nu output: " + path.string());
    }
    ConfigureClassic(stream);
    for (const DataRow &row : rows)
    {
      stream << row.energyEv << " " << row.dampingRatePerS << "\n";
    }
  }

  void WriteSNSIFile(
      const std::filesystem::path &path, const std::vector<DataRow> &rows)
  {
    std::ofstream stream(path);
    if (!stream)
    {
      throw std::runtime_error("cannot open SI SN output: " + path.string());
    }
    ConfigureClassic(stream);
    const double evToJ = eV / joule;
    for (const DataRow &row : rows)
    {
      stream << row.energyEv * evToJ << " "
             << row.stoppingCrossSectionEvM2 * evToJ << "\n";
    }
  }

  void WriteDensityValidationCsv(
      const std::filesystem::path &path,
      const DensityValidationSummary &summary)
  {
    std::ofstream stream(path);
    if (!stream)
    {
      throw std::runtime_error("cannot open density validation CSV: " + path.string());
    }
    ConfigureClassic(stream);
    stream << "E_eV,target_n_1_per_m3,actual_n_1_per_m3,"
           << "dEdx_eV_per_m,SN_eV_m2,dEdx_ratio_to_reference,"
           << "expected_ratio_from_actual_n,SN_ratio_to_reference\n";
    for (const auto &row : summary.rows)
    {
      stream << row.energyEv << "," << row.targetNumberDensityPerM3 << ","
             << row.actualNumberDensityPerM3 << "," << row.dEdxEvPerM
             << "," << row.stoppingCrossSectionEvM2 << ","
             << row.dEdxRatioToReference << ","
             << row.expectedRatioFromNumberDensity << ","
             << row.stoppingCrossSectionRatioToReference << "\n";
    }
  }

  void WriteMetadata(
      const std::filesystem::path &path,
      const std::string &mode,
      const std::string &physicsName,
      const G4EmParameters *parameters,
      const G4ParticleDefinition *muon,
      const G4Material *referenceMaterial,
      G4Element *neon,
      const G4VEnergyLossProcess *muIoni,
      const std::vector<double> &rowEnergiesEv,
      const std::vector<ModelInfo> &models,
      const std::vector<ModelSelectionInfo> &selections,
      const std::vector<CrossCheckInfo> &checks,
      const DensityValidationSummary *densitySummary,
      const std::string &masterName)
  {
    std::ofstream stream(path);
    if (!stream)
    {
      throw std::runtime_error("cannot open metadata JSON: " + path.string());
    }
    stream.imbue(std::locale::classic());
    stream << std::scientific << std::setprecision(16);

    const double targetNumberDensity = kReferenceNumberDensityPerM3;
    const double actualNumberDensity = ActualNumberDensityPerM3(referenceMaterial);
    const double densityRelativeError =
        std::abs(actualNumberDensity / targetNumberDensity - 1.0);
    const double massDensityKgM3 = referenceMaterial->GetDensity() / (kg / m3);
    const double massDensityGcm3 = referenceMaterial->GetDensity() / (g / cm3);
    const double minimumEnergyEv = parameters->MinKinEnergy() / eV;
    const double maximumEnergyEv = parameters->MaxKinEnergy() / eV;
    const std::string processParticle =
        (muIoni != nullptr && muIoni->Particle() != nullptr)
            ? G4StringToStd(muIoni->Particle()->GetParticleName())
            : "unknown";
    const std::string baseParticle =
        (muIoni != nullptr && muIoni->BaseParticle() != nullptr)
            ? G4StringToStd(muIoni->BaseParticle()->GetParticleName())
            : "none";

    stream << "{\n";
    stream << "  \"purpose\": \"COMSOL stage-1 muon cooling feasibility input\",\n";
    stream << "  \"generated_at_utc\": \"" << GenerationUtc() << "\",\n";
    stream << "  \"data_generation_git_commit\": \"unavailable (project not under git)\",\n";
    stream << "  \"geant4_version\": \"" << Geant4VersionString() << "\",\n";
    stream << "  \"geant4_version_tag\": \"" << JsonEscape(G4VERSION_TAG) << "\",\n";
    stream << "  \"geant4_install_prefix\": \"/opt/geant4/11.3.2\",\n";
    stream << "  \"geant4_data_environment\": \"configured by /opt/geant4/11.3.2/bin/geant4.sh\",\n";
    stream << "  \"physics_constructor\": \"" << JsonEscape(physicsName) << "\",\n";
    stream << "  \"physics_mode\": \"" << JsonEscape(mode) << "\",\n";
    stream << "  \"particle\": {\n";
    stream << "    \"name\": \"" << JsonEscape(muon->GetParticleName()) << "\",\n";
    stream << "    \"pdg_encoding\": " << muon->GetPDGEncoding() << ",\n";
    stream << "    \"charge_in_eplus\": " << muon->GetPDGCharge() / eplus << ",\n";
    stream << "    \"mass_kg\": " << MuonMassKg(muon) << "\n";
    stream << "  },\n";
    stream << "  \"material\": {\n";
    stream << "    \"name\": \"" << JsonEscape(referenceMaterial->GetName()) << "\",\n";
    stream << "    \"composition\": \"100% natural Neon (Ne)\",\n";
    stream << "    \"atomic_number\": " << neon->GetZ() << ",\n";
    stream << "    \"atomic_mass_g_per_mole\": "
           << neon->GetA() / (g / mole) << ",\n";
    stream << "    \"state\": \"gas\",\n";
    stream << "    \"pressure_input\": null,\n";
    stream << "    \"number_density_definition\": \"n_ref is the model input; mass density is computed internally as n_ref * A / N_A\",\n";
    stream << "    \"number_density_input_1_per_m3\": "
           << targetNumberDensity << ",\n";
    stream << "    \"mass_density_used_kg_per_m3\": "
           << massDensityKgM3 << ",\n";
    stream << "    \"mass_density_used_g_per_cm3\": "
           << massDensityGcm3 << ",\n";
    stream << "    \"actual_g4_atom_number_density_1_per_m3\": "
           << actualNumberDensity << ",\n";
    stream << "    \"actual_number_density_relative_error\": "
           << densityRelativeError << "\n";
    stream << "  },\n";
    stream << "  \"reference_number_density_1_per_m3\": "
           << targetNumberDensity << ",\n";
    stream << "  \"em_calculator\": {\n";
    stream << "    \"primary_method\": \"G4EmCalculator::ComputeTotalDEDX\",\n";
    stream << "    \"electronic_cross_check\": \"G4EmCalculator::ComputeElectronicDEDX\",\n";
    stream << "    \"table_cross_check\": \"G4EmCalculator::GetDEDX (restricted table)\",\n";
    stream << "    \"range_method\": \"G4EmCalculator::GetCSDARange\",\n";
    stream << "    \"csda_range_table_enabled\": "
           << (parameters->BuildCSDARange() ? "true" : "false") << "\n";
    stream << "  },\n";
    stream << "  \"muIoni\": {\n";
    stream << "    \"process_name\": \"muIoni\",\n";
    stream << "    \"requested_particle\": \"" << JsonEscape(muon->GetParticleName())
           << "\",\n";
    stream << "    \"process_particle\": \"" << JsonEscape(processParticle) << "\",\n";
    stream << "    \"base_particle_for_internal_tables\": \""
           << JsonEscape(baseParticle) << "\",\n";
    stream << "    \"number_of_models\": " << models.size() << ",\n";
    stream << "    \"models\": [\n";
    for (std::size_t i = 0; i < models.size(); ++i)
    {
      const auto &model = models[i];
      stream << "      {\"index\": " << model.index
             << ", \"name\": \"" << JsonEscape(model.name)
             << "\", \"low_energy_eV\": " << model.lowEnergyEv
             << ", \"high_energy_eV\": " << model.highEnergyEv << "}";
      if (i + 1 != models.size())
      {
        stream << ",";
      }
      stream << "\n";
    }
    stream << "    ],\n";
    stream << "    \"runtime_model_selection\": [\n";
    for (std::size_t i = 0; i < selections.size(); ++i)
    {
      const auto &selection = selections[i];
      stream << "      {\"energy_eV\": " << selection.energyEv
             << ", \"model\": \"" << JsonEscape(selection.name) << "\"}";
      if (i + 1 != selections.size())
      {
        stream << ",";
      }
      stream << "\n";
    }
    stream << "    ]\n";
    stream << "  },\n";
    stream << "  \"calculator_cross_checks\": [\n";
    for (std::size_t i = 0; i < checks.size(); ++i)
    {
      const auto &check = checks[i];
      stream << "    {\"E_eV\": " << check.energyEv
             << ", \"ComputeTotalDEDX_eV_per_m\": " << check.totalEvPerM
             << ", \"ComputeElectronicDEDX_eV_per_m\": "
             << check.electronicEvPerM
             << ", \"GetDEDX_eV_per_m\": " << check.tableEvPerM
             << ", \"GetDEDX_relative_to_total\": "
             << check.tableRelativeToTotal << "}";
      if (i + 1 != checks.size())
      {
        stream << ",";
      }
      stream << "\n";
    }
    stream << "  ],\n";
    stream << "  \"energy_grid\": {\n";
    stream << "    \"log_grid_points_requested\": " << kLogGridPoints << ",\n";
    stream << "    \"minimum_eV\": "
           << (rowEnergiesEv.empty() ? 0.0 : rowEnergiesEv.front()) << ",\n";
    stream << "    \"maximum_eV\": "
           << (rowEnergiesEv.empty() ? 0.0 : rowEnergiesEv.back()) << ",\n";
    stream << "    \"physics_constructor_minimum_eV\": " << minimumEnergyEv << ",\n";
    stream << "    \"physics_constructor_maximum_eV\": " << maximumEnergyEv << ",\n";
    stream << "    \"number_of_points\": " << rowEnergiesEv.size() << ",\n";
    stream << "    \"explicit_anchor_points_eV\": [";
    for (std::size_t i = 0; i < kAnchorEnergiesEv.size(); ++i)
    {
      stream << kAnchorEnergiesEv[i];
      if (i + 1 != kAnchorEnergiesEv.size())
      {
        stream << ", ";
      }
    }
    stream << "]\n";
    stream << "  },\n";
    stream << "  \"units\": {\n";
    stream << "    \"energy\": \"eV\",\n";
    stream << "    \"speed\": \"m/s\",\n";
    stream << "    \"stopping_power\": \"eV/m\",\n";
    stream << "    \"stopping_cross_section\": \"eV*m^2\",\n";
    stream << "    \"damping_rate\": \"s^-1\",\n";
    stream << "    \"csda_range\": \"m\"\n";
    stream << "  },\n";
    stream << "  \"low_energy_limitations\": {\n";
    stream << "    \"flag\": \"LOW ENERGY — EXPLORATORY / MODEL UNCERTAINTY\",\n";
    stream << "    \"caution_below_eV\": 1000.0,\n";
    stream << "    \"not_included\": [\n";
    stream << "      \"mu-minus-Ne elastic angular scattering\",\n";
    stream << "      \"low-energy atomic capture\",\n";
    stream << "      \"muonic atom formation\",\n";
    stream << "      \"atomic capture probability\",\n";
    stream << "      \"Auger and related atomic-cascade processes\",\n";
    stream << "      \"injection-window and device geometry\",\n";
    stream << "      \"complex detector simulation\"\n";
    stream << "    ]\n";
    stream << "  },\n";
    if (densitySummary != nullptr)
    {
      stream << "  \"density_scaling_validation\": {\n";
      stream << "    \"energies_eV\": [1000.0, 10000.0, 100000.0],\n";
      stream << "    \"densities_1_per_m3\": [1.0e21, 1.0e23, 1.0e25],\n";
      stream << "    \"max_actual_number_density_relative_error\": "
             << densitySummary->maxActualDensityRelativeError << ",\n";
      stream << "    \"max_dEdx_linearity_relative_error\": "
             << densitySummary->maxDensLinearRelativeError << ",\n";
      stream << "    \"max_SN_relative_error\": "
             << densitySummary->maxStoppingCrossSectionRelativeError << ",\n";
      stream << "    \"tolerance\": " << kDensityValidationTolerance << ",\n";
      stream << "    \"passed\": "
             << (densitySummary->passed ? "true" : "false") << "\n";
      stream << "  },\n";
    }
    else
    {
      stream << "  \"density_scaling_validation\": null,\n";
    }
    stream << "  \"comparison_note\": \"option4 is supplementary; option3 baseline and option4 are not averaged\",\n";
    stream << "  \"output_files\": {\n";
    stream << "    \"master_csv\": \"output/" << masterName << "\",\n";
    if (mode == "option3")
    {
      stream << "    \"comsol_SN_txt\": \"output/comsol_muNe_SN.txt\",\n";
      stream << "    \"comsol_nu_txt\": \"output/comsol_muNe_nu_ref.txt\",\n";
      stream << "    \"comsol_SN_SI_txt\": \"output/comsol_muNe_SN_SI.txt\",\n";
      stream << "    \"density_validation_csv\": \"output/density_scaling_validation.csv\",\n";
      stream << "    \"metadata_json\": \"output/metadata.json\"\n";
    }
    else
    {
      stream << "    \"metadata_json\": \"output/metadata_opt4.json\"\n";
    }
    stream << "  }\n";
    stream << "}\n";
  }

  void ValidateRows(
      const std::vector<DataRow> &rows, double minimumExpectedEnergyEv)
  {
    if (rows.empty())
    {
      throw std::runtime_error("energy grid is empty");
    }
    double previousEnergy = -1.0;
    for (const DataRow &row : rows)
    {
      if (!std::isfinite(row.energyEv) || !std::isfinite(row.speedMs) || !std::isfinite(row.dEdxEvPerM) || !std::isfinite(row.stoppingCrossSectionEvM2) || !std::isfinite(row.dampingRatePerS) || !std::isfinite(row.csdaRangeM))
      {
        throw std::runtime_error("non-finite value in stopping table");
      }
      if (row.energyEv <= previousEnergy)
      {
        throw std::runtime_error("energy grid is not strictly increasing");
      }
      if (row.energyEv + 1.0e-9 < minimumExpectedEnergyEv)
      {
        throw std::runtime_error("row is below physics constructor minimum");
      }
      if (row.dEdxEvPerM <= 0.0 || row.stoppingCrossSectionEvM2 <= 0.0 || row.dampingRatePerS <= 0.0 || row.speedMs <= 0.0 || row.csdaRangeM < 0.0)
      {
        throw std::runtime_error("non-positive stopping or kinematic value");
      }
      previousEnergy = row.energyEv;
    }
  }

  void PrintSummary(
      const std::string &mode,
      const std::string &version,
      const G4ParticleDefinition *muon,
      const G4Material *material,
      double actualNumberDensity,
      const std::vector<ModelInfo> &models,
      const std::vector<ModelSelectionInfo> &selections,
      const std::vector<DataRow> &rows,
      const DensityValidationSummary *densitySummary)
  {
    std::cout << std::setprecision(12) << std::scientific;
    std::cout << "Geant4 version: " << version << "\n";
    std::cout << "physics mode: " << mode << "\n";
    std::cout << "particle: " << muon->GetParticleName()
              << " (PDG " << muon->GetPDGEncoding() << ")\n";
    std::cout << "material: " << material->GetName() << " (pure Ne)\n";
    std::cout << "target n [1/m^3]: " << kReferenceNumberDensityPerM3
              << ", actual G4 n [1/m^3]: " << actualNumberDensity << "\n";
    std::cout << "muIoni models:\n";
    for (const auto &model : models)
    {
      std::cout << "  [" << model.index << "] " << model.name << " ["
                << model.lowEnergyEv << ", " << model.highEnergyEv
                << "] eV\n";
    }
    std::cout << "runtime model selections:\n";
    for (const auto &selection : selections)
    {
      std::cout << "  E=" << selection.energyEv << " eV -> "
                << selection.name << "\n";
    }
    std::cout << "rows: " << rows.size() << ", range ["
              << rows.front().energyEv << ", " << rows.back().energyEv
              << "] eV\n";
    for (const double requestedEnergy : {100000.0, 10000.0, 1000.0})
    {
      const auto it = std::find_if(
          rows.begin(), rows.end(),
          [requestedEnergy](const DataRow &row)
          {
            return std::abs(row.energyEv - requestedEnergy) <= 1.0e-8 * std::max(1.0, requestedEnergy);
          });
      if (it != rows.end())
      {
        std::cout << "E=" << it->energyEv << " eV: dEdx="
                  << it->dEdxEvPerM << " eV/m, SN="
                  << it->stoppingCrossSectionEvM2 << " eV*m^2, nu="
                  << it->dampingRatePerS << " s^-1, CSDA="
                  << it->csdaRangeM << " m\n";
      }
    }
    if (densitySummary != nullptr)
    {
      std::cout << "density scaling: "
                << (densitySummary->passed ? "PASS" : "FAIL")
                << " (max n err=" << densitySummary->maxActualDensityRelativeError
                << ", max dEdx linearity err="
                << densitySummary->maxDensLinearRelativeError
                << ", max SN err="
                << densitySummary->maxStoppingCrossSectionRelativeError
                << ")\n";
    }
  }

} // namespace

int main(int argc, char **argv)
{
  const std::string mode = (argc >= 2) ? argv[1] : "option3";
  const std::filesystem::path outputDir =
      (argc >= 3) ? std::filesystem::path(argv[2])
                  : std::filesystem::path("output");
  const bool isOption3 = mode == "option3";
  const bool isOption4 = mode == "option4";
  if (!isOption3 && !isOption4)
  {
    std::cerr << "usage: mu_ne_stopping [option3|option4] [output_dir]\n";
    return 2;
  }

  try
  {
    std::filesystem::create_directories(outputDir);

    auto *neon = G4NistManager::Instance()->FindOrBuildElement("Ne");
    if (neon == nullptr)
    {
      throw std::runtime_error("failed to build natural neon element");
    }

    // v03 freezes the density validation anchors at three decades spanning
    // the intended scan window.  The middle point is the reference material
    // so that S_N(E) remains a density-normalized observable.
    const std::vector<double> targetDensitiesPerM3 =
        {1.0e21, 1.0e23, 1.0e25};
    auto *lowDensityMaterial = BuildNeonMaterial(
        neon, targetDensitiesPerM3[0], "Neon_n1e21");
    auto *referenceMaterial = BuildNeonMaterial(
        neon, targetDensitiesPerM3[1], "NeonReference");
    auto *highDensityMaterial = BuildNeonMaterial(
        neon, targetDensitiesPerM3[2], "Neon_n1e25");
    const std::vector<G4Material *> scalingMaterials = {
        lowDensityMaterial, referenceMaterial, highDensityMaterial};

    auto *runManager =
        G4RunManagerFactory::CreateRunManager(G4RunManagerType::SerialOnly);
    runManager->SetUserInitialization(new DetectorConstruction(referenceMaterial));
    runManager->SetUserInitialization(new MinimalPhysicsList(isOption4));
    G4EmParameters *parameters = G4EmParameters::Instance();
    parameters->SetBuildCSDARange(true);
    runManager->Initialize();
    // Initialize() sets up geometry/processes. Geant4 builds loss and CSDA
    // tables during run initialization; zero events trigger that phase
    // without transporting any Monte Carlo tracks.
    runManager->BeamOn(0);

    auto *muon = G4MuonMinus::MuonMinus();
    if (muon == nullptr || muon->GetParticleName() != "mu-")
    {
      throw std::runtime_error("mu- particle definition was not initialized");
    }
    auto *muIoni = FindMuonIonisationProcess(muon);
    if (muIoni == nullptr)
    {
      throw std::runtime_error("muIoni was not found for mu-");
    }

    const std::string version = Geant4VersionString();
    const std::string physicsName =
        isOption3 ? "G4EmStandardPhysics_option3"
                  : "G4EmStandardPhysics_option4";
    const auto models = CollectModelInfo(muIoni);
    const double modelMinimumEv = parameters->MinKinEnergy() / eV;
    const auto selections =
        CollectRuntimeModelSelections(models, modelMinimumEv);
    if (models.empty())
    {
      throw std::runtime_error("muIoni has no initialized EM models");
    }

    std::vector<double> energyGrid = BuildEnergyGrid();
    energyGrid.erase(
        std::remove_if(
            energyGrid.begin(), energyGrid.end(),
            [modelMinimumEv](double energyEv)
            {
              return energyEv + 1.0e-9 < modelMinimumEv;
            }),
        energyGrid.end());

    G4EmCalculator calculator;
    const auto rows = ComputeRows(
        energyGrid, calculator, muon, referenceMaterial,
        kReferenceNumberDensityPerM3);
    ValidateRows(rows, modelMinimumEv);

    const auto checks = ComputeCrossChecks(
        calculator, muon, referenceMaterial, modelMinimumEv);

    DensityValidationSummary densitySummary;
    const DensityValidationSummary *densitySummaryPtr = nullptr;
    if (isOption3)
    {
      densitySummary = ComputeDensityValidation(
          calculator, muon, targetDensitiesPerM3, scalingMaterials,
          referenceMaterial);
      densitySummaryPtr = &densitySummary;
    }

    const std::string masterName =
        isOption3 ? "mu_minus_Ne_stopping_master.csv"
                  : "mu_minus_Ne_stopping_opt4.csv";
    WriteMasterCsv(outputDir / masterName, rows);

    if (isOption3)
    {
      WriteSNFile(outputDir / "comsol_muNe_SN.txt", rows);
      WriteNuFile(outputDir / "comsol_muNe_nu_ref.txt", rows);
      WriteSNSIFile(outputDir / "comsol_muNe_SN_SI.txt", rows);
      WriteDensityValidationCsv(
          outputDir / "density_scaling_validation.csv", densitySummary);
    }

    const std::string metadataName =
        isOption3 ? "metadata.json" : "metadata_opt4.json";
    std::vector<double> rowEnergies;
    rowEnergies.reserve(rows.size());
    for (const auto &row : rows)
    {
      rowEnergies.push_back(row.energyEv);
    }
    WriteMetadata(
        outputDir / metadataName, mode, physicsName, parameters, muon,
        referenceMaterial, neon, muIoni, rowEnergies, models, selections,
        checks, densitySummaryPtr, masterName);

    PrintSummary(
        mode, version, muon, referenceMaterial,
        ActualNumberDensityPerM3(referenceMaterial), models, selections, rows,
        densitySummaryPtr);

    delete runManager;
    if (isOption3 && !densitySummary.passed)
    {
      return 6;
    }
    return 0;
  }
  catch (const std::exception &error)
  {
    std::cerr << "ERROR: " << error.what() << "\n";
    return 1;
  }
}
