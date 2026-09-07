import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;

/** Fine acceptance scan around the two near-aperture phase boundaries. */
public final class RunStage1FineAcceptance {
    private RunStage1FineAcceptance() {}

    private static final class CaseSpec {
        final String name, fraction, gap12;
        final boolean geometryChanged;

        CaseSpec(String name, String fraction, String gap12, boolean geometryChanged) {
            this.name = name;
            this.fraction = fraction;
            this.gap12 = gap12;
            this.geometryChanged = geometryChanged;
        }
    }

    private static String path(File dir, String name) {
        return new File(dir, name).getAbsolutePath();
    }

    private static void setCase(Model model, CaseSpec spec) {
        model.param().set("Ne_number_density", "3e23[1/m^3]");
        model.param().set("source_radial_fraction_of_gas_radius", spec.fraction);
        model.param().set("initial_tangential_speed", "0*initial_radial_speed");
        model.param().set("voltage_difference_V1_to_V2", "0.5[kV]");
        model.param().set("voltage_difference_V2_to_V3", "2[kV]");
        model.param().set("voltage_difference_V3_to_V4", "-1.5[kV]");
        model.param().set("V1_to_V2_clear_spacing", spec.gap12);
        model.param().set("V2_to_V3_clear_spacing", "220[mm]");
        model.param().set("V3_to_V4_clear_spacing", "160[mm]");
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length != 2) {
            throw new IllegalArgumentException(
                    "Usage: RunStage1FineAcceptance <master.mph> <stage1-root>");
        }
        File master = new File(args[0]).getAbsoluteFile();
        File root = new File(args[1]).getAbsoluteFile();
        File out = new File(root, "intermediate/results/fine_acceptance_cases");
        Model model = ModelUtil.load("Stage1FineAcceptance", master.getAbsolutePath());

        CaseSpec[] cases = new CaseSpec[] {
                new CaseSpec("fine_source_0p010", "0.010", "130[mm]", false),
                new CaseSpec("fine_source_0p025", "0.025", "130[mm]", false),
                new CaseSpec("fine_source_0p040", "0.040", "130[mm]", false),
                new CaseSpec("fine_source_0p050", "0.050", "130[mm]", false),
                new CaseSpec("fine_source_0p060", "0.060", "130[mm]", false),
                new CaseSpec("fine_source_0p075", "0.075", "130[mm]", false),
                new CaseSpec("fine_source_0p090", "0.090", "130[mm]", false),
                new CaseSpec("fine_source_0p100", "0.100", "130[mm]", false),
                new CaseSpec("fine_gap12_17mm", "0.10", "17[mm]", true),
                new CaseSpec("fine_gap12_18mm", "0.10", "18[mm]", true),
                new CaseSpec("fine_gap12_19mm", "0.10", "19[mm]", true),
                new CaseSpec("fine_gap12_20mm", "0.10", "20[mm]", true),
                new CaseSpec("fine_gap12_21mm", "0.10", "21[mm]", true),
                new CaseSpec("fine_gap12_22mm", "0.10", "22[mm]", true),
                new CaseSpec("fine_gap12_23mm", "0.10", "23[mm]", true),
                new CaseSpec("fine_gap12_24mm", "0.10", "24[mm]", true),
                new CaseSpec("fine_gap12_37mm", "0.10", "37[mm]", true),
                new CaseSpec("fine_gap12_38mm", "0.10", "38[mm]", true),
                new CaseSpec("fine_gap12_39mm", "0.10", "39[mm]", true),
                new CaseSpec("fine_gap12_40mm", "0.10", "40[mm]", true),
                new CaseSpec("fine_gap12_41mm", "0.10", "41[mm]", true),
                new CaseSpec("fine_gap12_42mm", "0.10", "42[mm]", true),
                new CaseSpec("fine_gap12_43mm", "0.10", "43[mm]", true)
        };

        boolean fieldNeedsSolve = true;
        for (CaseSpec spec : cases) {
            System.out.println("FINE_CASE_START=" + spec.name);
            try {
                setCase(model, spec);
                if (spec.geometryChanged) {
                    model.component("comp1").geom("geom1").run();
                    model.component("comp1").mesh("mesh1").run();
                    fieldNeedsSolve = true;
                }
                if (fieldNeedsSolve) {
                    model.study("std_es").run();
                    fieldNeedsSolve = false;
                }
                model.study("std_single").run();
                model.result().numerical("gev_particle").setResult();
                model.result().table("tbl_particle").save(
                        path(out, spec.name + "_timeseries.csv"));
                model.result().numerical("gev_field").setResult();
                model.result().table("tbl_field").save(
                        path(out, spec.name + "_field.csv"));
                System.out.println("FINE_CASE_COMPLETE=" + spec.name);
            } catch (Exception ex) {
                System.out.println("FINE_CASE_FAILED=" + spec.name + " :: " + ex);
            }
        }
        model.save(path(root, "temporary/results/stage1_3d_after_fine_acceptance.mph"));
        System.out.println("CHECKPOINT_FINE_ACCEPTANCE_SAVED="
                + path(root, "temporary/results/stage1_3d_after_fine_acceptance.mph"));
        System.out.println("FINE_ACCEPTANCE_COMPLETE");
    }
}
