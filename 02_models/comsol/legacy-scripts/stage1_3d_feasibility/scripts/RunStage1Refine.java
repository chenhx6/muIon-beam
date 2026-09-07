import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;

/** Targeted refinement after the coarse sweep identified V2 aperture loss. */
public final class RunStage1Refine {
    private RunStage1Refine() {}

    private static final class CaseSpec {
        final String name, density, fraction, dv12, dv23, dv34, gap12, gap23, gap34;
        final boolean geometryChanged, fieldChanged;

        CaseSpec(String name, String density, String fraction, String dv12, String dv23,
                 String dv34, String gap12, String gap23, String gap34,
                 boolean geometryChanged, boolean fieldChanged) {
            this.name = name;
            this.density = density;
            this.fraction = fraction;
            this.dv12 = dv12;
            this.dv23 = dv23;
            this.dv34 = dv34;
            this.gap12 = gap12;
            this.gap23 = gap23;
            this.gap34 = gap34;
            this.geometryChanged = geometryChanged;
            this.fieldChanged = fieldChanged;
        }
    }

    private static CaseSpec source(String name, String fraction) {
        return new CaseSpec(name, "3e23[1/m^3]", fraction,
                "0.5[kV]", "2[kV]", "-1.5[kV]",
                "130[mm]", "220[mm]", "160[mm]", false, false);
    }

    private static CaseSpec dv12(String name, String dv12) {
        return new CaseSpec(name, "3e23[1/m^3]", "0.20", dv12,
                "2[kV]", "-(" + dv12.replace("[kV]", "") + "+2-1)[kV]",
                "130[mm]", "220[mm]", "160[mm]", false, true);
    }

    private static CaseSpec gap12(String name, String gap12) {
        return new CaseSpec(name, "3e23[1/m^3]", "0.20",
                "1[kV]", "2[kV]", "-2[kV]", gap12,
                "220[mm]", "160[mm]", true, true);
    }

    private static String path(File dir, String name) {
        return new File(dir, name).getAbsolutePath();
    }

    private static void setCase(Model model, CaseSpec spec) {
        model.param().set("Ne_number_density", spec.density);
        model.param().set("source_radial_fraction_of_gas_radius", spec.fraction);
        model.param().set("voltage_difference_V1_to_V2", spec.dv12);
        model.param().set("voltage_difference_V2_to_V3", spec.dv23);
        model.param().set("voltage_difference_V3_to_V4", spec.dv34);
        model.param().set("V1_to_V2_clear_spacing", spec.gap12);
        model.param().set("V2_to_V3_clear_spacing", spec.gap23);
        model.param().set("V3_to_V4_clear_spacing", spec.gap34);
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length != 2) {
            throw new IllegalArgumentException("Usage: RunStage1Refine <master.mph> <stage1-root>");
        }
        File master = new File(args[0]).getAbsoluteFile();
        File root = new File(args[1]).getAbsoluteFile();
        File out = new File(root, "intermediate/results/refine_cases");
        Model model = ModelUtil.load("Stage1Refine", master.getAbsolutePath());

        CaseSpec[] cases = new CaseSpec[] {
                source("refine_source_0p10", "0.10"),
                source("refine_source_0p15", "0.15"),
                source("refine_source_0p20", "0.20"),
                source("refine_source_0p25", "0.25"),
                source("refine_source_0p30", "0.30"),
                dv12("refine_V12_0p5kV", "0.5[kV]"),
                dv12("refine_V12_1p0kV", "1[kV]"),
                dv12("refine_V12_2p0kV", "2[kV]"),
                dv12("refine_V12_4p0kV", "4[kV]"),
                gap12("refine_gap12_20mm", "20[mm]"),
                gap12("refine_gap12_40mm", "40[mm]"),
                gap12("refine_gap12_60mm", "60[mm]"),
                gap12("refine_gap12_80mm", "80[mm]"),
                gap12("refine_gap12_100mm", "100[mm]")
        };

        boolean fieldNeedsSolve = true;
        for (CaseSpec spec : cases) {
            System.out.println("REFINE_CASE_START=" + spec.name);
            try {
                setCase(model, spec);
                if (spec.geometryChanged) {
                    model.component("comp1").geom("geom1").run();
                    model.component("comp1").mesh("mesh1").run();
                    fieldNeedsSolve = true;
                }
                if (spec.fieldChanged || fieldNeedsSolve) {
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
                System.out.println("REFINE_CASE_COMPLETE=" + spec.name);
            } catch (Exception ex) {
                System.out.println("REFINE_CASE_FAILED=" + spec.name + " :: " + ex);
            }
        }

        model.save(path(root, "temporary/results/stage1_3d_after_refine.mph"));
        System.out.println("CHECKPOINT_REFINE_RESULTS_SAVED="
                + path(root, "temporary/results/stage1_3d_after_refine.mph"));
        System.out.println("REFINE_COMPLETE");
    }
}
