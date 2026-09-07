import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;
import java.util.Arrays;

/**
 * Prepare and solve the centered-source Stage-1 3-D transport case.
 *
 * The canonical analytic-primitive Stage-1 MPH is loaded rather than
 * regenerated here.  This keeps the SolidWorks/COMSOL geometry checkpoint
 * immutable while allowing the release file, stopping interpolation, gas
 * density, voltages, and transient horizon to be changed reproducibly.
 * Positions in the ReleaseFromDataFile are in the component geometry unit
 * (mm); velocities are SI (m/s).  See generate_centered_release.py.
 */
public final class BuildCenteredStage1Model {
    private BuildCenteredStage1Model() {}

    private static String arg(String[] a, int i, String fallback) {
        return a.length > i ? a[i] : fallback;
    }

    private static boolean supplied(String value) {
        return value != null && value.length() > 0
                && !"''".equals(value) && !"\"\"".equals(value)
                && !"-".equals(value);
    }

    private static void setParam(Model m, String name, String value) {
        try {
            m.param().set(name, value);
        } catch (Exception ex) {
            System.out.println("PARAMETER_SET_FAILED=" + name + " :: " + ex);
        }
    }

    private static void configureParameters(Model m, String density, String dv12,
                                            String dv23, String v4minusv1,
                                            String tEnd, String dt) {
        setParam(m, "Ne_number_density", density + "[1/m^3]");
        setParam(m, "voltage_difference_V1_to_V2", dv12 + "[kV]");
        setParam(m, "voltage_difference_V2_to_V3", dv23 + "[kV]");
        // V4 is defined by the canonical model as an absolute potential.  Set
        // an explicit V4 target after the first three voltages are evaluated
        // in the caller when requested; this parameter is retained as a
        // convenient audit trail for the scan metadata.
        setParam(m, "centered_target_V4_minus_V1", v4minusv1 + "[kV]");
        setParam(m, "dt_output", dt + "[ns]");
        setParam(m, "t_end", tEnd + "[ns]");
        try {
            m.study("std_single").feature("time")
                    .set("tlist", "range(0,dt_output,t_end)");
            // The particle ensemble is diagnostic rather than a stiff
            // multiphysics feedback solve.  A moderate relative tolerance
            // preserves the 0.1-ns output/gyro resolution while avoiding
            // excessive femtosecond substeps in the low-energy tail.
            m.study("std_single").feature("time").set("rtol", "3e-5");
        } catch (Exception ex) {
            System.out.println("TIME_LIST_SET_FAILED=" + ex);
        }
    }

    private static void repairStoppingAndParticleModel(Model m, String stoppingFile,
                                                        String releaseFile) throws Exception {
        // The archived MPH was moved from an E:\ checkout.  Repoint and
        // import the actual table before any study is solved.
        m.func("intSN").set("filename", stoppingFile);
        m.func("intSN").importData();
        System.out.println("CENTERED_STOPPING_IMPORT_OK=" + stoppingFile);

        // Disable the legacy expression/grid release.  A second active
        // release would double-count particles and obscure transport loss.
        m.component("comp1").physics("cpt").feature("rel1").active(false);
        m.component("comp1").physics("cpt").create("rel_centered", "ReleaseFromDataFile", -1);
        m.component("comp1").physics("cpt").feature("rel_centered")
                .label("500-particle centered Larmor source (9 deg = 1 sigma)");
        m.component("comp1").physics("cpt").feature("rel_centered").set("Filename", releaseFile);
        m.component("comp1").physics("cpt").feature("rel_centered").set("icolp", "0");
        m.component("comp1").physics("cpt").feature("rel_centered")
                .set("VelocitySpecification", "SpecifyVelocity");
        m.component("comp1").physics("cpt").feature("rel_centered")
                .set("InitialVelocity", "FromFile");
        m.component("comp1").physics("cpt").feature("rel_centered").set("icolv", "3");
        m.component("comp1").physics("cpt").feature("rel_centered")
                .set("rt", new double[] {0.0});
        m.component("comp1").physics("cpt").feature("rel_centered").importData();
        System.out.println("CENTERED_RELEASE_IMPORT_OK=" + releaseFile);

        // Replace the archived Ktotal_J interpolation argument with the
        // documented eV-clamped argument and stop extrapolating below 10 eV.
        m.component("comp1").variable("var_particle").set("K_eval_eV",
                "max(Ktotal_eV,stopping_energy_min_eV)");
        m.component("comp1").variable("var_particle").set("Kperp_eV",
                "Kperp_J/1[eV]");
        m.component("comp1").variable("var_particle").set("Kz_eV",
                "Kz_J/1[eV]");
        m.component("comp1").variable("var_particle").set("local_stopping_eV_per_m",
                "Ne_number_density*SN_muNe(K_eval_eV)");
        m.component("comp1").variable("var_particle").set("local_stopping_J_per_m",
                "local_stopping_eV_per_m*1.602176634e-19[J/eV]");
        m.component("comp1").variable("var_particle").set("stopping_active",
                "if(Ktotal_eV>stopping_energy_min_eV,1,0)");
        m.component("comp1").variable("var_particle").set("perp_stopping_active",
                "if(Kperp_eV>10[eV],1,0)");
        m.component("comp1").variable("var_particle").set("perp_stopping_scale",
                "if(Kperp_eV>=1000[eV],1,if(Kperp_eV<=10[eV],0,"
                + "(Kperp_eV-10[eV])/(1000[eV]-10[eV])))");
        // The stopping table is only validated down to 10 eV.  A hard
        // 100-eV numerical floor for the *axial* drag keeps the full-stage
        // transient from taking femtosecond steps after a particle has
        // already been cooled; it does not affect the requested 10-eV
        // transverse event or the keV-scale extraction dynamics.
        m.component("comp1").variable("var_particle").set("stopping_scale",
                "if(Ktotal_eV>=100[eV],1,0)");
        m.component("comp1").variable("var_particle").set("E_radial_local",
                "(qx*es.Ex+qy*es.Ey)/max(radial_position,1e-12[m])");
        m.component("comp1").variable("var_particle").set("P_E",
                "q_mu*(es.Ex*cpt.vx+es.Ey*cpt.vy+es.Ez*cpt.vz)");
        m.component("comp1").variable("var_particle").set("U_mu_eV",
                "q_mu*(V-V1)/1[eV]");
        m.component("comp1").variable("var_particle").set("K_plus_U_eV",
                "Ktotal_eV+U_mu_eV");
        m.component("comp1").variable("var_particle").set("region_id",
                "if(qz<z_V1-electrode_thickness/2,0,"
                + "if(qz<z_V2-electrode_thickness/2,12,"
                + "if(qz<z_V3-electrode_thickness/2,23,"
                + "if(qz<z_V4-electrode_thickness/2,34,4))))");
        // Force expressions are reset explicitly because the loaded model may
        // contain a pre-move expression with the old stopping argument.
        m.component("comp1").physics("cpt").feature("cool1").set("F", new String[] {
                "-perp_stopping_scale*local_stopping_J_per_m*cpt.vx/particle_speed_smooth",
                "-perp_stopping_scale*local_stopping_J_per_m*cpt.vy/particle_speed_smooth",
                "-stopping_scale*local_stopping_J_per_m*cpt.vz/particle_speed_smooth"});
        // Keep the model's named exit/loss diagnostics but make the tolerance
        // explicit for this 100-ns run.
        setParam(m, "exit_classification_tolerance", "0.1[mm]");
        System.out.println("REL1_ACTIVE=" +
                m.component("comp1").physics("cpt").feature("rel1").isActive());
    }

    private static String solutionTag(Model m) {
        String[] tags = m.sol().tags();
        System.out.println("CENTERED_SOLUTIONS=" + Arrays.toString(tags));
        return tags.length == 0 ? "sol2" : tags[tags.length - 1];
    }

    private static void makeParticleDataset(Model m, String solution) {
        try { m.result().dataset().create("part_centered", "Particle"); }
        catch (Exception ex) { System.out.println("PARTICLE_DATASET_CREATE_FAILED=" + ex); return; }
        m.result().dataset("part_centered").label("Centered 500-particle Stage-1 trajectories");
        m.result().dataset("part_centered").set("solution", solution);
        m.result().dataset("part_centered").set("posdof",
                new String[] {"comp1.qx", "comp1.qy", "comp1.qz"});
        m.result().dataset("part_centered").set("geom", "geom1");
        m.result().dataset("part_centered").set("pgeom", "pgeom_cpt");
        m.result().dataset("part_centered").set("pgeomspec", "fromphysics");
        m.result().dataset("part_centered").set("physicsinterface", "cpt");
    }

    private static void particleExport(Model m, String tag, String tableTag,
                                       String expression, String description,
                                       String input, String output) {
        try {
            m.result().numerical().create(tag, "Particle");
            m.result().numerical(tag).set("data", "part_centered");
            m.result().numerical(tag).set("expr", expression);
            m.result().numerical(tag).set("evaluate", "all");
            m.result().numerical(tag).set("innerinput", input);
            // COMSOL uses the description as a result-column label and
            // requires labels to be unique across a model.  Distinguish the
            // history and endpoint exports explicitly.
            m.result().numerical(tag).set("descr", description + " (" + input + ")");
            m.result().table().create(tableTag, "Table");
            m.result().table(tableTag).label(description);
            m.result().numerical(tag).set("table", tableTag);
            m.result().numerical(tag).setResult();
            m.result().table(tableTag).save(output);
            System.out.println("PARTICLE_EXPORT_OK=" + output);
        } catch (Exception ex) {
            System.out.println("PARTICLE_EXPORT_FAILED=" + expression + " :: " + ex);
        }
    }

    private static void exportParticleTables(Model m, File out, boolean fullHistory) {
        String input = fullHistory ? "all" : "last";
        String[][] items = new String[][] {
                {"qx", "qx", "x position"}, {"qy", "qy", "y position"},
                {"qz", "qz", "z position"}, {"cpt.vx", "vx", "x velocity"},
                {"cpt.vy", "vy", "y velocity"}, {"cpt.vz", "vz", "z velocity"},
                {"Kperp_eV", "Kperp_eV", "transverse kinetic energy"},
                {"Kz_eV", "Kz_eV", "axial kinetic energy"},
                {"Ktotal_eV", "Ktotal_eV", "total kinetic energy"},
                {"radial_position", "radial_position", "radial position"},
                {"E_total_local", "E_total_local", "electric field magnitude"},
                {"E_transverse_local", "E_transverse_local", "transverse electric field"},
                {"E_radial_local", "E_radial_local", "radial electric field"},
                {"P_E", "P_E", "electric work power"},
                {"U_mu_eV", "U_mu_eV", "negative-muon electrostatic potential energy"},
                {"K_plus_U_eV", "K_plus_U_eV", "kinetic plus electrostatic energy"},
                {"local_stopping_eV_per_m", "stopping_eV_per_m", "Ne stopping power"},
                {"region_id", "region_id", "axial cavity identifier"},
                {"is_exit", "is_exit", "exit flag"}, {"is_wall", "is_wall", "wall flag"},
                {"is_electrode", "is_electrode", "electrode flag"},
                {"is_backward", "is_backward", "backward flag"},
                {"particlestatus", "particle_status", "COMSOL particle status (1 active, 2 frozen, 3 stuck, 4 disappeared)"},
                {"st", "stop_time", "COMSOL particle stop time"},
                {"fs", "final_status", "COMSOL final particle status"}
        };
        int i = 1;
        String tagPrefix = fullHistory ? "hist" : "exit";
        for (String[] item : items) {
            String suffix = fullHistory ? "_history" : "_exit";
            particleExport(m, "pev_centered_" + tagPrefix + "_" + i,
                    "tbl_centered_" + tagPrefix + "_" + i,
                    item[0], item[2], input,
                    new File(out, item[1] + suffix + ".csv").getAbsolutePath());
            i++;
        }
    }

    private static void createCutPlane(Model m, String tag, String label,
                                       String plane, String coordinate) {
        try {
            m.result().dataset().create(tag, "CutPlane");
            m.result().dataset(tag).label(label);
            m.result().dataset(tag).set("data", "dset1");
            m.result().dataset(tag).set("planetype", "quick");
            m.result().dataset(tag).set("quickplane", plane);
            if ("zx".equals(plane) || "xz".equals(plane))
                m.result().dataset(tag).set("quicky", coordinate);
            else if ("yz".equals(plane) || "zy".equals(plane))
                m.result().dataset(tag).set("quickx", coordinate);
            else
                m.result().dataset(tag).set("quickz", coordinate);
            System.out.println("CUTPLANE_CREATED=" + tag);
        } catch (Exception ex) {
            System.out.println("CUTPLANE_FAILED=" + tag + " :: " + ex);
        }
    }

    private static void fieldExport(Model m, String tag, String dataset,
                                    String[] expressions, String output) {
        try {
            m.result().export().create(tag, dataset, "Data");
            m.result().export(tag).set("expr", expressions);
            m.result().export(tag).set("filename", output);
            m.result().export(tag).set("location", "fromdataset");
            m.result().export(tag).set("gridstruct", "spreadsheet");
            m.result().export(tag).set("includecoords", true);
            m.result().export(tag).set("header", "on");
            m.result().export(tag).set("ifexists", "overwrite");
            m.result().export(tag).run();
            System.out.println("FIELD_EXPORT_OK=" + output);
        } catch (Exception ex) {
            System.out.println("FIELD_EXPORT_FAILED=" + tag + " :: " + ex);
        }
    }

    private static void createFieldData(Model m, File out) {
        createCutPlane(m, "cut_xz_centered", "Global y=0 (x-z plane)", "zx", "0");
        createCutPlane(m, "cut_yz_centered", "Global x=0 (y-z plane)", "yz", "0");
        String[] field = new String[] {"x", "y", "z", "V", "es.Ex", "es.Ey", "es.Ez",
                "E_total", "E_transverse", "U_mu_eV"};
        fieldExport(m, "exp_field_xz_centered", "cut_xz_centered", field,
                new File(out, "field_global_xz.csv").getAbsolutePath());
        fieldExport(m, "exp_field_yz_centered", "cut_yz_centered", field,
                new File(out, "field_global_yz.csv").getAbsolutePath());
        String[] potential = new String[] {"x", "y", "z", "V", "U_mu_eV"};
        fieldExport(m, "exp_potential_xz_centered", "cut_xz_centered", potential,
                new File(out, "potential_global_xz.csv").getAbsolutePath());
        try {
            m.result().dataset().create("cut_axis_centered", "CutLine3D");
            m.result().dataset("cut_axis_centered").set("data", "dset1");
            m.result().dataset("cut_axis_centered").set("genpoints", new String[][] {
                    {"0", "0", "0"}, {"0", "0", "Lstage1"}});
            fieldExport(m, "exp_axis_centered", "cut_axis_centered",
                    new String[] {"x", "y", "z", "V", "es.Ez", "E_total", "U_mu_eV"},
                    new File(out, "field_axis_centered.csv").getAbsolutePath());
        } catch (Exception ex) {
            System.out.println("AXIS_EXPORT_FAILED=" + ex);
        }
    }

    private static void fieldDiagnostics(Model m, File out) {
        try {
            m.result().table().create("tbl_centered_field_summary", "Table");
            m.result().numerical().create("gev_centered_field", "EvalGlobal");
            m.result().numerical("gev_centered_field").set("data", "dset1");
            m.result().numerical("gev_centered_field").set("expr", new String[] {
                    "max_E_total", "max_E_in_Ne", "max_E_at_aperture",
                    "average_E_V1_V2", "average_E_V2_V3", "average_E_V3_V4"});
            m.result().numerical("gev_centered_field").set("unit", new String[] {
                    "V/m", "V/m", "V/m", "V/m", "V/m", "V/m"});
            m.result().numerical("gev_centered_field").set("table", "tbl_centered_field_summary");
            m.result().numerical("gev_centered_field").setResult();
            m.result().table("tbl_centered_field_summary").save(
                    new File(out, "field_summary_comsol.csv").getAbsolutePath());
        } catch (Exception ex) {
            System.out.println("FIELD_DIAGNOSTICS_FAILED=" + ex);
        }
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length < 4) {
            throw new IllegalArgumentException(
                    "Usage: BuildCenteredStage1Model <master.mph> <release.txt> <stopping.txt> <output.mph> [density] [dv12_kV] [dv23_kV] [v4minusv1_kV] [output-root] [aperture_diameter_mm] [gap12_mm] [gap23_mm] [gap34_mm]");
        }
        String master = args[0];
        String release = args[1];
        String stopping = args[2];
        String outputMph = args[3];
        String density = arg(args, 4, "1e24");
        String dv12 = arg(args, 5, "0.5");
        String dv23 = arg(args, 6, "2.0");
        String v4minusv1 = arg(args, 7, "1.0");
        // Argument 8 is an explicit, already-created output directory.  Do
        // not append another tables/... component: this also makes it easy to
        // launch independent baseline/candidate/final cases side by side.
        File outputRoot = new File(arg(args, 8,
                new File(outputMph).getParentFile().getParent()
                        + "\\tables\\centered\\transport_baseline"));
        File history = new File(outputRoot, "history");
        File exit = new File(outputRoot, "exit");
        String apertureMm = arg(args, 9, "");
        String gap12Mm = arg(args, 10, "");
        String gap23Mm = arg(args, 11, "");
        String gap34Mm = arg(args, 12, "");
        String wallCondition = arg(args, 13, "Freeze");
        String stoppingMode = arg(args, 14, "on");

        System.out.println("CENTERED_MASTER=" + master);
        System.out.println("CENTERED_RELEASE=" + release);
        System.out.println("CENTERED_STOPPING=" + stopping);
        System.out.println("CENTERED_DENSITY=" + density);
        System.out.println("CENTERED_DV12_KV=" + dv12);
        System.out.println("CENTERED_DV23_KV=" + dv23);
        System.out.println("CENTERED_V4_MINUS_V1_KV=" + v4minusv1);

        Model m = ModelUtil.load("CenteredStage1", master);
        m.label("centered_stage1_transport.mph");
        configureParameters(m, density, dv12, dv23, v4minusv1, "100", "0.1");
        repairStoppingAndParticleModel(m, stopping, release);
        if ("off".equalsIgnoreCase(stoppingMode)) {
            m.component("comp1").physics("cpt").feature("cool1").set("F",
                    new String[] {"0", "0", "0"});
            System.out.println("CENTERED_STOPPING_FORCE=OFF_TEST_MODE");
        }
        try {
            m.component("comp1").physics("cpt").feature("wall1")
                    .set("WallCondition", wallCondition);
            System.out.println("CENTERED_WALL_CONDITION=" + wallCondition);
        } catch (Exception ex) {
            System.out.println("CENTERED_WALL_CONDITION_SET_FAILED=" + ex);
        }
        boolean geometryChanged = false;
        if (supplied(apertureMm)) {
            setParam(m, "electrode_aperture_diameter", apertureMm + "[mm]");
            geometryChanged = true;
        }
        if (supplied(gap12Mm)) {
            setParam(m, "V1_to_V2_clear_spacing", gap12Mm + "[mm]");
            geometryChanged = true;
        }
        if (supplied(gap23Mm)) {
            setParam(m, "V2_to_V3_clear_spacing", gap23Mm + "[mm]");
            geometryChanged = true;
        }
        if (supplied(gap34Mm)) {
            setParam(m, "V3_to_V4_clear_spacing", gap34Mm + "[mm]");
            geometryChanged = true;
        }
        if (geometryChanged) {
            try {
                m.component("comp1").geom("geom1").run();
                // ``sel_cpt_gas`` is an Explicit selection in the canonical
                // MPH.  Geometry regeneration can change entity numbers;
                // refresh it from the boolean gas-domain selection before
                // solving, otherwise electric/magnetic/stopping forces stop
                // silently at the first regenerated interface (typically the
                // V2 aperture).
                m.component("comp1").selection("sel_cpt_gas")
                        .set(m.component("comp1").selection("geom1_gaswork_dom").entities());
                m.component("comp1").physics("cpt").selection().named("sel_cpt_gas");
                m.component("comp1").physics("cpt").feature("ef1").selection().named("sel_cpt_gas");
                m.component("comp1").physics("cpt").feature("mf1").selection().named("sel_cpt_gas");
                m.component("comp1").physics("cpt").feature("cool1").selection().named("sel_cpt_gas");
                m.component("comp1").mesh("mesh1").run();
                System.out.println("CENTERED_GEOMETRY_REBUILT=true");
            } catch (Exception ex) {
                System.out.println("CENTERED_GEOMETRY_REBUILD_FAILED=" + ex);
                throw ex;
            }
        }
        // V1 is the reference in the canonical model.  For the requested
        // final-energy scan, hold V1=0 and set V4 directly to the target
        // potential; V2/V3 remain the two transport increments.
        setParam(m, "voltage_V1", "0[V]");
        setParam(m, "V4", v4minusv1 + "[kV]");
        m.study("std_es").run();
        System.out.println("CENTERED_ELECTROSTATICS_SOLVED=true");
        m.study("std_single").run();
        System.out.println("CENTERED_PARTICLE_SOLVED=true");

        String sol = solutionTag(m);
        makeParticleDataset(m, sol);
        exportParticleTables(m, history, true);
        // The endpoint is the final row of every history table.  COMSOL 6.4
        // refuses to create a second Particle Evaluation for the same
        // expression in one model (duplicate result-column labels), so keep
        // one authoritative all-time table and let the reducer extract the
        // endpoint without a second solve/export pass.
        System.out.println("ENDPOINT_FROM_HISTORY=true");
        fieldDiagnostics(m, new File(outputRoot, "field"));
        createFieldData(m, new File(outputRoot, "field"));
        m.save(outputMph);
        System.out.println("CENTERED_STAGE1_SAVED=" + outputMph);
        System.out.println("CENTERED_STAGE1_COMPLETE=true");
    }
}
