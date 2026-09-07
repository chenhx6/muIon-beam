import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;

/**
 * TEST_ONLY phase/acceptance scan.  A tangential velocity component changes
 * the Larmor phase while the initial total energy remains 100 keV and the
 * radial component remains inward.  This is not a beam-divergence study.
 */
public final class RunStage1VelocityPhaseScan {
    private RunStage1VelocityPhaseScan() {}

    private static String path(File dir, String name) {
        return new File(dir, name).getAbsolutePath();
    }

    private static void setCase(Model model, String density, String fraction, String tangent) {
        model.param().set("Ne_number_density", density);
        model.param().set("source_radial_fraction_of_gas_radius", fraction);
        model.param().set("initial_tangential_speed", tangent + "*initial_radial_speed");
        model.param().set("voltage_difference_V1_to_V2", "0.5[kV]");
        model.param().set("voltage_difference_V2_to_V3", "2[kV]");
        model.param().set("voltage_difference_V3_to_V4", "-1.5[kV]");
        model.param().set("V1_to_V2_clear_spacing", "130[mm]");
        model.param().set("V2_to_V3_clear_spacing", "220[mm]");
        model.param().set("V3_to_V4_clear_spacing", "160[mm]");
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length != 2) {
            throw new IllegalArgumentException(
                    "Usage: RunStage1VelocityPhaseScan <master.mph> <stage1-root>");
        }
        File master = new File(args[0]).getAbsoluteFile();
        File root = new File(args[1]).getAbsoluteFile();
        File out = new File(root, "intermediate/results/velocity_phase_cases");
        Model model = ModelUtil.load("Stage1VelocityPhaseScan", master.getAbsolutePath());

        String[] tangent = {"-0.50", "-0.40", "-0.30", "-0.20", "-0.10", "0",
                            "0.10", "0.20", "0.30", "0.40", "0.50"};
        boolean fieldNeedsSolve = true;
        for (String value : tangent) {
            String name = "phase_f0p10_t" + value.replace("-", "minus").replace(".", "p");
            System.out.println("VELOCITY_PHASE_CASE_START=" + name);
            try {
                setCase(model, "3e23[1/m^3]", "0.10", value);
                if (fieldNeedsSolve) {
                    model.study("std_es").run();
                    fieldNeedsSolve = false;
                }
                model.study("std_single").run();
                model.result().numerical("gev_particle").setResult();
                model.result().table("tbl_particle").save(path(out, name + "_timeseries.csv"));
                model.result().numerical("gev_field").setResult();
                model.result().table("tbl_field").save(path(out, name + "_field.csv"));
                System.out.println("VELOCITY_PHASE_CASE_COMPLETE=" + name);
            } catch (Exception ex) {
                System.out.println("VELOCITY_PHASE_CASE_FAILED=" + name + " :: " + ex);
            }
        }

        String[] densityNames = {"phase_f0p10_n1e22", "phase_f0p10_n3e22",
                                 "phase_f0p10_n1e23"};
        String[] densityValues = {"1e22[1/m^3]", "3e22[1/m^3]", "1e23[1/m^3]"};
        for (int index = 0; index < densityNames.length; ++index) {
            String name = densityNames[index];
            System.out.println("VELOCITY_PHASE_CASE_START=" + name);
            try {
                setCase(model, densityValues[index], "0.10", "0");
                model.study("std_single").run();
                model.result().numerical("gev_particle").setResult();
                model.result().table("tbl_particle").save(path(out, name + "_timeseries.csv"));
                model.result().numerical("gev_field").setResult();
                model.result().table("tbl_field").save(path(out, name + "_field.csv"));
                System.out.println("VELOCITY_PHASE_CASE_COMPLETE=" + name);
            } catch (Exception ex) {
                System.out.println("VELOCITY_PHASE_CASE_FAILED=" + name + " :: " + ex);
            }
        }

        model.save(path(root, "temporary/results/stage1_3d_after_velocity_phase_scan.mph"));
        System.out.println("CHECKPOINT_VELOCITY_PHASE_SAVED="
                + path(root, "temporary/results/stage1_3d_after_velocity_phase_scan.mph"));
        System.out.println("VELOCITY_PHASE_SCAN_COMPLETE");
    }
}
