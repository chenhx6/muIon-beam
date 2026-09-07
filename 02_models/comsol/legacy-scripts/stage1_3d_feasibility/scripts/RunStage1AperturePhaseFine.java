import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;

/** Millimetre-subdivision scan around the two closest V2 aperture encounters. */
public final class RunStage1AperturePhaseFine {
    private RunStage1AperturePhaseFine() {}

    private static String path(File dir, String name) {
        return new File(dir, name).getAbsolutePath();
    }

    private static String mmName(double value) {
        return String.format(java.util.Locale.ROOT, "%.1f", value).replace('.', 'p');
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length != 2) {
            throw new IllegalArgumentException(
                    "Usage: RunStage1AperturePhaseFine <master.mph> <stage1-root>");
        }
        File master = new File(args[0]).getAbsoluteFile();
        File root = new File(args[1]).getAbsoluteFile();
        File out = new File(root, "intermediate/results/aperture_phase_fine_cases");
        Model model = ModelUtil.load("Stage1AperturePhaseFine", master.getAbsolutePath());

        double[] gaps = new double[] {
                19.5, 19.6, 19.7, 19.8, 19.9, 20.0, 20.1, 20.2, 20.3, 20.4, 20.5,
                39.5, 39.6, 39.7, 39.8, 39.9, 40.0, 40.1, 40.2, 40.3, 40.4, 40.5
        };
        boolean fieldNeedsSolve = true;
        for (double gap : gaps) {
            String name = "fine2_gap12_" + mmName(gap) + "mm";
            System.out.println("APERTURE_FINE_CASE_START=" + name);
            try {
                model.param().set("Ne_number_density", "3e23[1/m^3]");
                model.param().set("source_radial_fraction_of_gas_radius", "0.10");
                model.param().set("initial_tangential_speed", "0*initial_radial_speed");
                model.param().set("voltage_difference_V1_to_V2", "0.5[kV]");
                model.param().set("voltage_difference_V2_to_V3", "2[kV]");
                model.param().set("voltage_difference_V3_to_V4", "-1.5[kV]");
                model.param().set("V1_to_V2_clear_spacing", gap + "[mm]");
                model.param().set("V2_to_V3_clear_spacing", "220[mm]");
                model.param().set("V3_to_V4_clear_spacing", "160[mm]");
                model.component("comp1").geom("geom1").run();
                model.component("comp1").mesh("mesh1").run();
                fieldNeedsSolve = true;
                if (fieldNeedsSolve) {
                    model.study("std_es").run();
                    fieldNeedsSolve = false;
                }
                model.study("std_single").run();
                model.result().numerical("gev_particle").setResult();
                model.result().table("tbl_particle").save(path(out, name + "_timeseries.csv"));
                model.result().numerical("gev_field").setResult();
                model.result().table("tbl_field").save(path(out, name + "_field.csv"));
                System.out.println("APERTURE_FINE_CASE_COMPLETE=" + name);
            } catch (Exception ex) {
                System.out.println("APERTURE_FINE_CASE_FAILED=" + name + " :: " + ex);
            }
        }
        model.save(path(root, "temporary/results/stage1_3d_after_aperture_phase_fine.mph"));
        System.out.println("CHECKPOINT_APERTURE_PHASE_FINE_SAVED="
                + path(root, "temporary/results/stage1_3d_after_aperture_phase_fine.mph"));
        System.out.println("APERTURE_PHASE_FINE_COMPLETE");
    }
}
