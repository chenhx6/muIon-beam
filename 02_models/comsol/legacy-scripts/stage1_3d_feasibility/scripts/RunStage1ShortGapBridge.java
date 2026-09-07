import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;

/** Targeted short-gap V1-V2 acceptance scan before abandoning axial entry. */
public final class RunStage1ShortGapBridge {
    private RunStage1ShortGapBridge() {}

    private static String path(File dir, String name) {
        return new File(dir, name).getAbsolutePath();
    }

    private static String name(String gap, String fraction, String dv12) {
        return "shortgap_" + gap.replace("[mm]", "mm").replace(".", "p")
                + "_f" + fraction.replace(".", "p")
                + "_V12_" + dv12.replace("[kV]", "kV").replace(".", "p");
    }

    private static void setCase(Model model, String gap, String fraction, String dv12) {
        model.param().set("Ne_number_density", "3e23[1/m^3]");
        model.param().set("source_radial_fraction_of_gas_radius", fraction);
        model.param().set("initial_tangential_speed", "0*initial_radial_speed");
        model.param().set("voltage_difference_V1_to_V2", dv12);
        model.param().set("voltage_difference_V2_to_V3", "5[kV]");
        model.param().set("voltage_difference_V3_to_V4",
                "-(" + dv12.replace("[kV]", "") + "+5-1)[kV]");
        model.param().set("V1_to_V2_clear_spacing", gap);
        model.param().set("V2_to_V3_clear_spacing", "220[mm]");
        model.param().set("V3_to_V4_clear_spacing", "160[mm]");
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length != 2) {
            throw new IllegalArgumentException(
                    "Usage: RunStage1ShortGapBridge <master.mph> <stage1-root>");
        }
        File master = new File(args[0]).getAbsoluteFile();
        File root = new File(args[1]).getAbsoluteFile();
        File out = new File(root, "intermediate/results/short_gap_bridge_cases");
        Model model = ModelUtil.load("Stage1ShortGapBridge", master.getAbsolutePath());

        String[] gaps = {"15[mm]", "20[mm]", "25[mm]", "40[mm]"};
        String[] fractions = {"0.05", "0.10"};
        String[] dv12s = {"1[kV]", "3[kV]", "5[kV]"};
        for (String gap : gaps) {
            for (String fraction : fractions) {
                for (String dv12 : dv12s) {
                    String caseName = name(gap, fraction, dv12);
                    System.out.println("SHORT_GAP_CASE_START=" + caseName);
                    try {
                        setCase(model, gap, fraction, dv12);
                        model.component("comp1").geom("geom1").run();
                        model.component("comp1").mesh("mesh1").run();
                        model.study("std_es").run();
                        model.study("std_single").run();
                        model.result().numerical("gev_particle").setResult();
                        model.result().table("tbl_particle").save(
                                path(out, caseName + "_timeseries.csv"));
                        model.result().numerical("gev_field").setResult();
                        model.result().table("tbl_field").save(
                                path(out, caseName + "_field.csv"));
                        System.out.println("SHORT_GAP_CASE_COMPLETE=" + caseName);
                    } catch (Exception ex) {
                        System.out.println("SHORT_GAP_CASE_FAILED=" + caseName + " :: " + ex);
                    }
                }
            }
        }
        model.save(path(root, "temporary/results/stage1_3d_after_short_gap_bridge.mph"));
        System.out.println("CHECKPOINT_SHORT_GAP_BRIDGE_SAVED="
                + path(root, "temporary/results/stage1_3d_after_short_gap_bridge.mph"));
        System.out.println("SHORT_GAP_BRIDGE_COMPLETE");
    }
}
