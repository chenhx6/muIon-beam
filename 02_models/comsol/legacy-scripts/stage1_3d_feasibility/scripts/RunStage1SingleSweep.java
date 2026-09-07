import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;

/**
 * Coarse-to-interpret single-muon sweep for the solved Stage-1 3-D model.
 *
 * The sweep deliberately changes one small parameter family at a time.  Each
 * COMSOL table is retained under intermediate/results/single_sweep_cases and
 * is aggregated later by the Python data-reduction script.
 */
public final class RunStage1SingleSweep {
    private RunStage1SingleSweep() {}

    private static final class CaseSpec {
        final String name;
        final String density;
        final String sourceFraction;
        final String dv12;
        final String dv23;
        final String dv34;
        final String gap12;
        final String gap23;
        final String gap34;
        final boolean geometryChanged;
        final boolean electricFieldChanged;

        CaseSpec(String name, String density, String sourceFraction,
                 String dv12, String dv23, String dv34,
                 String gap12, String gap23, String gap34,
                 boolean geometryChanged, boolean electricFieldChanged) {
            this.name = name;
            this.density = density;
            this.sourceFraction = sourceFraction;
            this.dv12 = dv12;
            this.dv23 = dv23;
            this.dv34 = dv34;
            this.gap12 = gap12;
            this.gap23 = gap23;
            this.gap34 = gap34;
            this.geometryChanged = geometryChanged;
            this.electricFieldChanged = electricFieldChanged;
        }
    }

    private static String path(File directory, String name) {
        return new File(directory, name).getAbsolutePath();
    }

    private static CaseSpec density(String name, String n) {
        return new CaseSpec(name, n, "0.50", "0.5[kV]", "2.0[kV]", "-1.5[kV]",
                "130[mm]", "220[mm]", "160[mm]", false, false);
    }

    private static CaseSpec source(String name, String n, String fraction) {
        return new CaseSpec(name, n, fraction, "0.5[kV]", "2.0[kV]", "-1.5[kV]",
                "130[mm]", "220[mm]", "160[mm]", false, false);
    }

    private static CaseSpec voltage(String name, String n, String fraction,
                                    String dv12, String dv23, String dv34) {
        return new CaseSpec(name, n, fraction, dv12, dv23, dv34,
                "130[mm]", "220[mm]", "160[mm]", false, true);
    }

    private static CaseSpec spacing(String name, String n, String fraction,
                                    String gap12, String gap23, String gap34) {
        return new CaseSpec(name, n, fraction, "0.5[kV]", "2.0[kV]", "-1.5[kV]",
                gap12, gap23, gap34, true, true);
    }

    private static void setCase(Model model, CaseSpec spec) {
        model.param().set("Ne_number_density", spec.density);
        model.param().set("source_radial_fraction_of_gas_radius", spec.sourceFraction);
        model.param().set("voltage_difference_V1_to_V2", spec.dv12);
        model.param().set("voltage_difference_V2_to_V3", spec.dv23);
        model.param().set("voltage_difference_V3_to_V4", spec.dv34);
        model.param().set("V1_to_V2_clear_spacing", spec.gap12);
        model.param().set("V2_to_V3_clear_spacing", spec.gap23);
        model.param().set("V3_to_V4_clear_spacing", spec.gap34);
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length != 2) {
            throw new IllegalArgumentException(
                    "Usage: RunStage1SingleSweep <master.mph> <stage1-root>");
        }
        File master = new File(args[0]).getAbsoluteFile();
        File root = new File(args[1]).getAbsoluteFile();
        File caseDirectory = new File(root, "intermediate/results/single_sweep_cases");
        // The directory is pre-created by the PowerShell launcher.  COMSOL's
        // batch security layer can reject Java mkdirs() even for an existing
        // project path, so do not create directories from inside the model.

        Model model = ModelUtil.load("Stage1SingleSweep", master.getAbsolutePath());
        CaseSpec[] cases = new CaseSpec[] {
                density("density_1e22", "1e22[1/m^3]"),
                density("density_3e22", "3e22[1/m^3]"),
                density("density_1e23", "1e23[1/m^3]"),
                density("density_3e23_extended", "3e23[1/m^3]"),

                source("source_0p30_n3e23", "3e23[1/m^3]", "0.30"),
                source("source_0p40_n3e23", "3e23[1/m^3]", "0.40"),
                source("source_0p50_n3e23", "3e23[1/m^3]", "0.50"),

                voltage("V12_0p25kV_n3e23", "3e23[1/m^3]", "0.40",
                        "0.25[kV]", "2.0[kV]", "-1.25[kV]"),
                voltage("V12_0p50kV_n3e23", "3e23[1/m^3]", "0.40",
                        "0.50[kV]", "2.0[kV]", "-1.50[kV]"),
                voltage("V12_1p00kV_n3e23", "3e23[1/m^3]", "0.40",
                        "1.00[kV]", "2.0[kV]", "-2.00[kV]"),

                voltage("V23_1p0kV_n3e23", "3e23[1/m^3]", "0.40",
                        "0.50[kV]", "1.0[kV]", "-0.50[kV]"),
                voltage("V23_2p0kV_n3e23", "3e23[1/m^3]", "0.40",
                        "0.50[kV]", "2.0[kV]", "-1.50[kV]"),
                voltage("V23_3p0kV_n3e23", "3e23[1/m^3]", "0.40",
                        "0.50[kV]", "3.0[kV]", "-2.50[kV]"),

                voltage("V34_minus0p5kV_n3e23", "3e23[1/m^3]", "0.40",
                        "0.50[kV]", "2.0[kV]", "-0.50[kV]"),
                voltage("V34_minus1p0kV_n3e23", "3e23[1/m^3]", "0.40",
                        "0.50[kV]", "2.0[kV]", "-1.00[kV]"),
                voltage("V34_minus1p5kV_n3e23", "3e23[1/m^3]", "0.40",
                        "0.50[kV]", "2.0[kV]", "-1.50[kV]"),
                voltage("V34_minus2p0kV_n3e23", "3e23[1/m^3]", "0.40",
                        "0.50[kV]", "2.0[kV]", "-2.00[kV]"),

                spacing("spacing_100_220_160_n3e23", "3e23[1/m^3]", "0.40",
                        "100[mm]", "220[mm]", "160[mm]"),
                spacing("spacing_130_180_160_n3e23", "3e23[1/m^3]", "0.40",
                        "130[mm]", "180[mm]", "160[mm]"),
                spacing("spacing_160_220_160_n3e23", "3e23[1/m^3]", "0.40",
                        "160[mm]", "220[mm]", "160[mm]")
        };

        boolean fieldNeedsSolve = true;
        for (CaseSpec spec : cases) {
            System.out.println("SWEEP_CASE_START=" + spec.name);
            try {
                setCase(model, spec);
                if (spec.geometryChanged) {
                    model.component("comp1").geom("geom1").run();
                    model.component("comp1").mesh("mesh1").run();
                    fieldNeedsSolve = true;
                }
                if (spec.electricFieldChanged || fieldNeedsSolve) {
                    model.study("std_es").run();
                    fieldNeedsSolve = false;
                }
                model.study("std_single").run();
                model.result().numerical("gev_particle").setResult();
                model.result().table("tbl_particle").save(
                        path(caseDirectory, spec.name + "_timeseries.csv"));
                model.result().numerical("gev_field").setResult();
                model.result().table("tbl_field").save(
                        path(caseDirectory, spec.name + "_field.csv"));
                System.out.println("SWEEP_CASE_COMPLETE=" + spec.name);
            } catch (Exception ex) {
                System.out.println("SWEEP_CASE_FAILED=" + spec.name + " :: " + ex);
            }
        }

        model.save(path(root, "temporary/results/stage1_3d_after_single_sweep.mph"));
        System.out.println("CHECKPOINT_SINGLE_SWEEP_RESULTS_SAVED="
                + path(root, "temporary/results/stage1_3d_after_single_sweep.mph"));
        System.out.println("SINGLE_SWEEP_COMPLETE");
    }
}
