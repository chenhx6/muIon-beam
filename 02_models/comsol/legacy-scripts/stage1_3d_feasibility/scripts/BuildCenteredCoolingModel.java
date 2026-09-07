import com.comsol.model.Model;
import com.comsol.model.physics.PhysicsFeature;
import com.comsol.model.util.ModelUtil;

import java.io.File;
import java.util.Arrays;

/**
 * Build and solve the no-voltage, 1-T pure-Ne centered-orbit calibration.
 *
 * The release file contains one row per particle: x y z vx vy vz in SI units.
 * Particle Evaluation tables are exported with one column per particle so the
 * Python reducer can compute distributions and first-threshold times without
 * replacing the deterministic COMSOL trajectories by an aggregate average.
 */
public final class BuildCenteredCoolingModel {
    private BuildCenteredCoolingModel() {}

    private static String path(File dir, String name) {
        return new File(dir, name).getAbsolutePath();
    }

    private static void addParticleEvaluation(Model model, String tag, String tableTag,
                                              String expression, String description,
                                              File output) {
        model.result().numerical().create(tag, "Particle");
        model.result().numerical(tag).set("data", "part_cooling");
        model.result().numerical(tag).set("expr", expression);
        model.result().numerical(tag).set("evaluate", "all");
        model.result().numerical(tag).set("innerinput", "all");
        model.result().numerical(tag).set("descr", description);
        model.result().table().create(tableTag, "Table");
        model.result().table(tableTag).label(description);
        model.result().numerical(tag).set("table", tableTag);
        model.result().numerical(tag).setResult();
        model.result().table(tableTag).save(output.getAbsolutePath());
    }

    private static void setParameters(Model model) {
        model.param().set("m_mu", "1.8835315557426432e-28[kg]",
                "CONFIRMED negative-muon mass");
        model.param().set("q_mu", "-e_const", "CONFIRMED q_mu=-e");
        model.param().set("magnetic_field_axial", "1[T]",
                "CONFIRMED uniform +z calibration field");
        model.param().set("Ne_number_density", "1e23[1/m^3]",
                "Calibration sweep parameter");
        model.param().set("Ne_temperature", "300[K]",
                "Reference temperature; no pressure model in calibration");
        model.param().set("stopping_energy_min_eV", "10[eV]",
                "Geant4 interface lower bound");
        model.param().set("v_floor", "1[m/s]", "Numerical speed guard");
        model.param().set("cooling_threshold_eV", "10[eV]",
                "Kperp crossing threshold");
        model.param().set("calibration_radius", "100[mm]",
                "Large radial boundary for intrinsic cooling");
        // The 100-keV release has a ~13 Mm/s speed.  A 1.2-m calibration
        // cylinder lets the ±9° axial tail reach an end cap before it cools,
        // which would bias the intrinsic gas result toward the uncooled
        // particles.  Use a 3-m domain and release at its mid-plane instead.
        model.param().set("calibration_length", "3000[mm]",
                "Axial boundary kept outside the 100-ns angular-spread envelope");
        model.param().set("dt_output", "0.1[ns]",
                "Output cadence for gyro-resolved diagnostics");
        model.param().set("t_end", "100[ns]", "Cooling horizon");
    }

    private static void createGeometry(Model model) {
        model.component("comp1").geom().create("geom1", 3);
        model.component("comp1").geom("geom1").lengthUnit("mm");
        model.component("comp1").geom("geom1").create("cal0", "Cylinder");
        model.component("comp1").geom("geom1").feature("cal0")
                .set("r", "calibration_radius");
        model.component("comp1").geom("geom1").feature("cal0")
                .set("h", "calibration_length");
        model.component("comp1").geom("geom1").feature("cal0")
                .set("pos", new String[] {"0", "0", "0"});
        model.component("comp1").geom("geom1").feature("cal0")
                .set("selresult", true);
        model.component("comp1").geom("geom1").run();
        System.out.println("CALIBRATION_GEOMETRY_COMPLETE");
    }

    private static void createPhysics(Model model, String stoppingFile, String releaseFile) {
        model.func().create("intSN", "Interpolation");
        model.func("intSN").label("Geant4 11.3.2 mu- Neon SN(E)");
        model.func("intSN").set("source", "file");
        model.func("intSN").set("filename", stoppingFile);
        model.func("intSN").set("nargs", "1");
        model.func("intSN").setIndex("funcs", "SN_muNe", 0, 0);
        model.func("intSN").set("argunit", "eV");
        model.func("intSN").set("fununit", "eV*m^2");
        try {
            model.func("intSN").importData();
            System.out.println("STOPPING_IMPORT_OK=" + model.func("intSN").getString("filename"));
        } catch (Exception ex) {
            System.out.println("STOPPING_IMPORT_FAIL=" + ex);
            throw ex;
        }

        model.component("comp1").physics().create("cpt", "ChargedParticleTracing", "geom1");
        model.component("comp1").physics("cpt")
                .label("Centered mu- 3-D cooling calibration, E=0 and Bz=1 T");
        model.component("comp1").physics("cpt").selection().all();
        setOptional(model, "cpt", "RelativisticCorrection", "RelativisticCorrection", "0");
        setOptional(model, "cpt", "StoreParticleStatusData", "StoreParticleStatusData", "1");
        setOptional(model, "cpt", "StoreParticleReleaseStatistics",
                "StoreParticleReleaseStatistics", "1");

        PhysicsFeature pp = model.component("comp1").physics("cpt").feature("pp1");
        pp.label("User-defined negative muon, q=-e");
        pp.set("ParticleSpecies", "UserDefined");
        pp.set("mp", "m_mu");
        pp.set("Z", "-1");

        model.component("comp1").physics("cpt").create("mf1", "MagneticForce", 3);
        model.component("comp1").physics("cpt").feature("mf1")
                .label("Uniform magnetic field Bz=1 T");
        model.component("comp1").physics("cpt").feature("mf1").selection().all();
        model.component("comp1").physics("cpt").feature("mf1").set("B_src", "userdef");
        model.component("comp1").physics("cpt").feature("mf1").set("B",
                new String[] {"0", "0", "magnetic_field_axial"});

        model.component("comp1").physics("cpt").create("cool1", "Force", 3);
        model.component("comp1").physics("cpt").feature("cool1")
                .label("Ktotal-based Geant4 mean stopping force");
        model.component("comp1").physics("cpt").feature("cool1").selection().all();
        model.component("comp1").physics("cpt").feature("cool1").set("SpecifyForce", "Directly");
        model.component("comp1").physics("cpt").feature("cool1").set("F", new String[] {
                "-perp_stopping_scale*local_stopping_J_per_m*cpt.vx/particle_speed_smooth",
                "-perp_stopping_scale*local_stopping_J_per_m*cpt.vy/particle_speed_smooth",
                // Phase A is a transverse-cooling calibration.  Once the
                // requested Kperp threshold is reached, turn off all model
                // drag and record the event; continuing to extrapolate an
                // axial 1/v drag below the 10-eV table limit creates a very
                // stiff, irrelevant tail in the 100-ns solve.
                "-perp_stopping_scale*local_stopping_J_per_m*cpt.vz/particle_speed_smooth"});

        model.component("comp1").physics("cpt").create("rel_centered", "ReleaseFromDataFile", -1);
        model.component("comp1").physics("cpt").feature("rel_centered")
                .label("500-particle centered Larmor source");
        model.component("comp1").physics("cpt").feature("rel_centered").set("Filename", releaseFile);
        model.component("comp1").physics("cpt").feature("rel_centered").set("icolp", "0");
        model.component("comp1").physics("cpt").feature("rel_centered")
                .set("VelocitySpecification", "SpecifyVelocity");
        model.component("comp1").physics("cpt").feature("rel_centered")
                .set("InitialVelocity", "FromFile");
        model.component("comp1").physics("cpt").feature("rel_centered").set("icolv", "3");
        model.component("comp1").physics("cpt").feature("rel_centered")
                .set("rt", new double[] {0.0});
        model.component("comp1").physics("cpt").feature("rel_centered").importData();

        model.component("comp1").physics("cpt").feature("wall1")
                .label("Freeze at calibration-domain boundary");
        model.component("comp1").physics("cpt").feature("wall1")
                .set("WallCondition", "Freeze");
    }

    private static void setOptional(Model model, String physicsTag, String property,
                                    String key, String value) {
        try {
            model.component("comp1").physics(physicsTag).prop(property).set(key, value);
        } catch (Exception ex) {
            System.out.println("OPTIONAL_PROPERTY_SKIPPED=" + physicsTag + "/" + property + "/" + key);
        }
    }

    private static void createVariables(Model model) {
        model.component("comp1").variable().create("var_particle");
        model.component("comp1").variable("var_particle")
                .label("Centered-source cooling diagnostics");
        model.component("comp1").variable("var_particle").set("particle_speed",
                "sqrt(cpt.vx^2+cpt.vy^2+cpt.vz^2)");
        model.component("comp1").variable("var_particle").set("particle_speed_smooth",
                "sqrt(cpt.vx^2+cpt.vy^2+cpt.vz^2+v_floor^2)");
        model.component("comp1").variable("var_particle").set("Kperp_J",
                "0.5*m_mu*(cpt.vx^2+cpt.vy^2)");
        model.component("comp1").variable("var_particle").set("Kz_J",
                "0.5*m_mu*cpt.vz^2");
        model.component("comp1").variable("var_particle").set("Ktotal_J",
                "0.5*m_mu*(cpt.vx^2+cpt.vy^2+cpt.vz^2)");
        model.component("comp1").variable("var_particle").set("Kperp_eV",
                "Kperp_J/1[eV]");
        model.component("comp1").variable("var_particle").set("Kz_eV",
                "Kz_J/1[eV]");
        model.component("comp1").variable("var_particle").set("Ktotal_eV",
                "Ktotal_J/1[eV]");
        model.component("comp1").variable("var_particle").set("K_eval_eV",
                "max(Ktotal_eV,stopping_energy_min_eV)");
        model.component("comp1").variable("var_particle").set("local_stopping_eV_per_m",
                "Ne_number_density*SN_muNe(K_eval_eV)");
        model.component("comp1").variable("var_particle").set("local_stopping_J_per_m",
                "local_stopping_eV_per_m*1.602176634e-19[J/eV]");
        model.component("comp1").variable("var_particle").set("stopping_active",
                "if(Ktotal_eV>stopping_energy_min_eV,1,0)");
        // Turn off the transverse drag exactly at the requested diagnostic
        // threshold and taper the axial drag between 100 and 10 eV.  The
        // supplied stopping table is not validated below 10 eV; a hard
        // extrapolated 1/v force there makes the transient unnecessarily
        // stiff and can dominate the numerical result.
        model.component("comp1").variable("var_particle").set("perp_stopping_active",
                "if(Kperp_eV>cooling_threshold_eV,1,0)");
        model.component("comp1").variable("var_particle").set("perp_stopping_scale",
                "if(Kperp_eV>=1000[eV],1,if(Kperp_eV<=cooling_threshold_eV,0,"
                + "(Kperp_eV-cooling_threshold_eV)/(1000[eV]-cooling_threshold_eV)))");
        model.component("comp1").variable("var_particle").set("stopping_scale",
                "if(Ktotal_eV>=100[eV],1,if(Ktotal_eV<=stopping_energy_min_eV,0,"
                + "(Ktotal_eV-stopping_energy_min_eV)/(100[eV]-stopping_energy_min_eV)))");
        model.component("comp1").variable("var_particle").set("radial_position",
                "sqrt(qx^2+qy^2)");
        model.component("comp1").variable("var_particle").set("gyro_radius",
                "m_mu*sqrt(cpt.vx^2+cpt.vy^2)/(abs(q_mu)*magnetic_field_axial)");
        model.component("comp1").variable("var_particle").set("cooling_reached",
                "if(Kperp_eV<=cooling_threshold_eV,1,0)");
        model.component("comp1").variable("var_particle").set("boundary_flag",
                "if((qx^2+qy^2)>calibration_radius^2,1,0)+if(qz<0,1,0)"
                + "+if(qz>calibration_length,1,0)");
    }

    private static void createStudy(Model model) {
        model.study().create("std_cooling");
        model.study("std_cooling").label("Centered source cooling, no voltage");
        model.study("std_cooling").create("time", "Transient");
        model.study("std_cooling").feature("time")
                .set("tlist", "range(0,dt_output,t_end)");
        model.study("std_cooling").feature("time").set("usertol", true);
        model.study("std_cooling").feature("time").set("rtol", "1e-6");
    }

    private static void createResults(Model model, File outputDirectory) {
        model.result().dataset().create("part_cooling", "Particle");
        model.result().dataset("part_cooling").label("Centered source cooling trajectories");
        // The first transient study creates the canonical solution tag sol1.
        // Keep the explicit dataset link here so the exported particle tables
        // remain valid after a model reload.
        model.result().dataset("part_cooling").set("solution", "sol1");
        model.result().dataset("part_cooling").set("posdof",
                new String[] {"comp1.qx", "comp1.qy", "comp1.qz"});
        model.result().dataset("part_cooling").set("geom", "geom1");
        model.result().dataset("part_cooling").set("pgeom", "pgeom_cpt");
        model.result().dataset("part_cooling").set("pgeomspec", "fromphysics");
        model.result().dataset("part_cooling").set("physicsinterface", "cpt");

        String[][] exports = new String[][] {
                {"qx", "cooling_qx.csv", "Particle x position"},
                {"qy", "cooling_qy.csv", "Particle y position"},
                {"qz", "cooling_qz.csv", "Particle z position"},
                // Particle Evaluation resolves particle velocity through the
                // charged-particle-tracing namespace.  Plain vx/vy/vz are
                // spatial PDE variables and are rejected by COMSOL 6.4.
                {"cpt.vx", "cooling_vx.csv", "Particle x velocity"},
                {"cpt.vy", "cooling_vy.csv", "Particle y velocity"},
                {"cpt.vz", "cooling_vz.csv", "Particle z velocity"},
                {"Kperp_eV", "cooling_Kperp_eV.csv", "Particle transverse kinetic energy"},
                {"Kz_eV", "cooling_Kz_eV.csv", "Particle axial kinetic energy"},
                {"Ktotal_eV", "cooling_Ktotal_eV.csv", "Particle total kinetic energy"},
                {"gyro_radius", "cooling_gyro_radius.csv", "Instantaneous gyro radius"},
                {"radial_position", "cooling_radial_position.csv", "Particle radial position"},
                {"cooling_reached", "cooling_reached.csv", "Kperp threshold flag"},
                {"boundary_flag", "cooling_boundary_flag.csv", "Calibration boundary flag"}
        };
        int index = 1;
        for (String[] item : exports) {
            addParticleEvaluation(model, "pev" + index, "tblpev" + index,
                    item[0], item[2], new File(outputDirectory, item[1]));
            index++;
        }

        // A Particle dataset is not an ordinary spatial dataset and COMSOL
        // 6.4 does not accept it as the input to EvalGlobal (the old dset2
        // placeholder caused an otherwise successful solve to exit with an
        // "unknown dataset" error).  The raw per-particle tables above are
        // deliberately retained; the Python reducer computes ensemble means
        // and percentiles without silently averaging frozen particles.
        try {
            model.result().table().create("tbl_cooling_mean", "Table");
            model.result().numerical().create("gev_cooling_mean", "EvalGlobal");
            model.result().numerical("gev_cooling_mean").set("data", "part_cooling");
            model.result().numerical("gev_cooling_mean").set("expr", new String[] {
                    "Kperp_eV", "Kz_eV", "Ktotal_eV", "gyro_radius", "cooling_reached"});
            model.result().numerical("gev_cooling_mean").set("table", "tbl_cooling_mean");
            model.result().numerical("gev_cooling_mean").setResult();
            model.result().table("tbl_cooling_mean").save(
                    new File(outputDirectory, "cooling_mean_timeseries.csv").getAbsolutePath());
        } catch (Exception ex) {
            System.out.println("COOLING_MEAN_EXPORT_SKIPPED=" + ex);
        }
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length < 3) {
            throw new IllegalArgumentException(
                    "Usage: BuildCenteredCoolingModel <stage1-root> <release.txt> <stopping.txt> [output.mph]");
        }
        File root = new File(args[0]).getAbsoluteFile();
        // Pass input paths exactly as supplied.  COMSOL's batch sandbox can
        // reject java.io.File existence/path normalization for an input file,
        // while the model API can import the same absolute path directly.
        String releaseFile = args[1];
        String stoppingFile = args[2];
        System.out.println("CENTERED_INPUT_RELEASE=" + releaseFile);
        System.out.println("CENTERED_INPUT_STOPPING=" + stoppingFile);
        File outputDirectory = new File(root, "tables/centered/cooling");
        File mph = args.length > 3 ? new File(args[3]).getAbsoluteFile()
                : new File(root, "comsol/centered_cooling_calibration.mph").getAbsoluteFile();

        Model model = ModelUtil.create("CenteredCoolingCalibration");
        model.label("centered_cooling_calibration.mph");
        model.comments("No-voltage 1-T centered-Larmor-source calibration. "
                + "Geant4 mean stopping only; no decay, capture, or angular collision model.");
        setParameters(model);
        model.component().create("comp1", true);
        createGeometry(model);
        createPhysics(model, stoppingFile, releaseFile);
        createVariables(model);
        model.component("comp1").mesh().create("mesh1");
        model.component("comp1").mesh("mesh1").autoMeshSize(5);
        model.component("comp1").mesh("mesh1").run();
        createStudy(model);

        // Parent directories are created by the launcher.  COMSOL batch
        // security can reject Java mkdirs() even for an authorized project
        // path, so the model itself never creates directories.
        model.save(mph.getAbsolutePath());
        System.out.println("CENTERED_COOLING_MODEL_SAVED=" + mph.getAbsolutePath());
        model.study("std_cooling").run();
        model.save(mph.getAbsolutePath());
        System.out.println("CENTERED_COOLING_SOLVED=true");
        createResults(model, outputDirectory);
        model.save(mph.getAbsolutePath());
        System.out.println("CENTERED_COOLING_RESULTS_SAVED=" + mph.getAbsolutePath());
        System.out.println("CENTERED_COOLING_COMPLETE");
    }
}
