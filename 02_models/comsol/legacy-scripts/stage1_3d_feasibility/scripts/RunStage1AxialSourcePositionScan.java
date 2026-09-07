import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;

/** TEST_ONLY scan of source axial location within the V1-V2 gap. */
public final class RunStage1AxialSourcePositionScan {
    private RunStage1AxialSourcePositionScan() {}

    private static String path(File dir, String name) {
        return new File(dir, name).getAbsolutePath();
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length != 2) {
            throw new IllegalArgumentException(
                    "Usage: RunStage1AxialSourcePositionScan <master.mph> <stage1-root>");
        }
        File master = new File(args[0]).getAbsoluteFile();
        File root = new File(args[1]).getAbsoluteFile();
        File out = new File(root, "intermediate/results/axial_source_cases");
        Model model = ModelUtil.load("Stage1AxialSourcePositionScan", master.getAbsolutePath());

        String[] fractions = {"0.50", "0.70", "0.80", "0.90", "0.95", "0.98", "0.99"};
        String[] gaps = {"130[mm]", "80[mm]", "40[mm]"};
        for (String gap : gaps) {
            for (String fraction : fractions) {
                String name = "axial_source_gap" + gap.replace("[mm]", "mm")
                        + "_frac" + fraction.replace(".", "p");
                System.out.println("AXIAL_SOURCE_CASE_START=" + name);
                try {
                    model.param().set("Ne_number_density", "3e23[1/m^3]");
                    model.param().set("source_radial_fraction_of_gas_radius", "0.10");
                    model.param().set("source_fraction_between_V1_V2", fraction);
                    model.param().set("initial_tangential_speed", "0*initial_radial_speed");
                    model.param().set("voltage_difference_V1_to_V2", "5[kV]");
                    model.param().set("voltage_difference_V2_to_V3", "5[kV]");
                    model.param().set("voltage_difference_V3_to_V4", "-9[kV]");
                    model.param().set("V1_to_V2_clear_spacing", gap);
                    model.param().set("V2_to_V3_clear_spacing", "220[mm]");
                    model.param().set("V3_to_V4_clear_spacing", "160[mm]");
                    model.component("comp1").geom("geom1").run();
                    model.component("comp1").mesh("mesh1").run();
                    model.study("std_es").run();
                    model.study("std_single").run();
                    model.result().numerical("gev_particle").setResult();
                    model.result().table("tbl_particle").save(
                            path(out, name + "_timeseries.csv"));
                    model.result().numerical("gev_field").setResult();
                    model.result().table("tbl_field").save(path(out, name + "_field.csv"));
                    System.out.println("AXIAL_SOURCE_CASE_COMPLETE=" + name);
                } catch (Exception ex) {
                    System.out.println("AXIAL_SOURCE_CASE_FAILED=" + name + " :: " + ex);
                }
            }
        }
        model.save(path(root, "temporary/results/stage1_3d_after_axial_source_scan.mph"));
        System.out.println("CHECKPOINT_AXIAL_SOURCE_SAVED="
                + path(root, "temporary/results/stage1_3d_after_axial_source_scan.mph"));
        System.out.println("AXIAL_SOURCE_SCAN_COMPLETE");
    }
}
