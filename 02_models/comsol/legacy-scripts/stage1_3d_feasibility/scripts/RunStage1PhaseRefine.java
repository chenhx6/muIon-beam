import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;

/**
 * Small phase/acceptance refinement after the V2 aperture-loss diagnosis.
 * The tangential-velocity values are explicitly TEST_ONLY orbit-phase probes;
 * the nominal source remains radial inward with zero tangential velocity.
 */
public final class RunStage1PhaseRefine {
    private RunStage1PhaseRefine() {}

    private static final class CaseSpec {
        final String name, fraction, tangent, gap12;
        final boolean geometryChanged;

        CaseSpec(String name, String fraction, String tangent, String gap12,
                 boolean geometryChanged) {
            this.name = name;
            this.fraction = fraction;
            this.tangent = tangent;
            this.gap12 = gap12;
            this.geometryChanged = geometryChanged;
        }
    }

    private static String path(File dir, String name) {
        return new File(dir, name).getAbsolutePath();
    }

    private static void setCommon(Model model, CaseSpec spec) {
        model.param().set("Ne_number_density", "3e23[1/m^3]");
        model.param().set("source_radial_fraction_of_gas_radius", spec.fraction);
        model.param().set("initial_tangential_speed", spec.tangent + "*initial_radial_speed");
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
                    "Usage: RunStage1PhaseRefine <master.mph> <stage1-root>");
        }
        File master = new File(args[0]).getAbsoluteFile();
        File root = new File(args[1]).getAbsoluteFile();
        File out = new File(root, "intermediate/results/phase_refine_cases");
        Model model = ModelUtil.load("Stage1PhaseRefine", master.getAbsolutePath());

        CaseSpec[] cases = new CaseSpec[] {
                new CaseSpec("phase_source0p10_tminus0p15", "0.10", "-0.15", "130[mm]", false),
                new CaseSpec("phase_source0p10_tminus0p10", "0.10", "-0.10", "130[mm]", false),
                new CaseSpec("phase_source0p10_tminus0p05", "0.10", "-0.05", "130[mm]", false),
                new CaseSpec("phase_source0p10_tzero", "0.10", "0", "130[mm]", false),
                new CaseSpec("phase_source0p10_tplus0p05", "0.10", "0.05", "130[mm]", false),
                new CaseSpec("phase_source0p10_tplus0p10", "0.10", "0.10", "130[mm]", false),
                new CaseSpec("phase_source0p10_tplus0p15", "0.10", "0.15", "130[mm]", false),
                new CaseSpec("phase_source0p05_tzero", "0.05", "0", "130[mm]", false),
                new CaseSpec("phase_source0p075_tzero", "0.075", "0", "130[mm]", false),
                new CaseSpec("phase_source0p125_tzero", "0.125", "0", "130[mm]", false),
                new CaseSpec("phase_source0p15_tzero", "0.15", "0", "130[mm]", false),
                new CaseSpec("phase_source0p10_gap10mm", "0.10", "0", "10[mm]", true),
                new CaseSpec("phase_source0p10_gap20mm", "0.10", "0", "20[mm]", true),
                new CaseSpec("phase_source0p10_gap30mm", "0.10", "0", "30[mm]", true),
                new CaseSpec("phase_source0p10_gap40mm", "0.10", "0", "40[mm]", true)
        };

        boolean fieldNeedsSolve = true;
        for (CaseSpec spec : cases) {
            System.out.println("PHASE_CASE_START=" + spec.name);
            try {
                setCommon(model, spec);
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
                System.out.println("PHASE_CASE_COMPLETE=" + spec.name);
            } catch (Exception ex) {
                System.out.println("PHASE_CASE_FAILED=" + spec.name + " :: " + ex);
            }
        }
        model.save(path(root, "temporary/results/stage1_3d_after_phase_refine.mph"));
        System.out.println("CHECKPOINT_PHASE_REFINE_RESULTS_SAVED="
                + path(root, "temporary/results/stage1_3d_after_phase_refine.mph"));
        System.out.println("PHASE_REFINE_COMPLETE");
    }
}
