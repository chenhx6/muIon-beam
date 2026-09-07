import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;

/**
 * Targeted transport-bridge scan: strengthen V2-V3 enough to test whether a
 * particle that clears the rounded V2 aperture can remain axially transported
 * while the Ktotal-based stopping force is active.
 */
public final class RunStage1TransportBridgeScan {
    private RunStage1TransportBridgeScan() {}

    private static String path(File dir, String name) {
        return new File(dir, name).getAbsolutePath();
    }

    private static void setCase(Model model, String density, String fraction,
                                String gap12, String dv12, String dv23) {
        model.param().set("Ne_number_density", density);
        model.param().set("source_radial_fraction_of_gas_radius", fraction);
        model.param().set("initial_tangential_speed", "0*initial_radial_speed");
        model.param().set("voltage_difference_V1_to_V2", dv12);
        model.param().set("voltage_difference_V2_to_V3", dv23);
        // Keep V4 at approximately +1 kV for the final axial-energy target.
        model.param().set("voltage_difference_V3_to_V4",
                "-(" + dv12.replace("[kV]", "") + "+"
                        + dv23.replace("[kV]", "") + "-1)[kV]");
        model.param().set("V1_to_V2_clear_spacing", gap12);
        model.param().set("V2_to_V3_clear_spacing", "220[mm]");
        model.param().set("V3_to_V4_clear_spacing", "160[mm]");
    }

    private static final class CaseSpec {
        final String name, density, fraction, gap12, dv12, dv23;
        final boolean geometryChanged;
        CaseSpec(String name, String density, String fraction, String gap12,
                 String dv12, String dv23, boolean geometryChanged) {
            this.name = name;
            this.density = density;
            this.fraction = fraction;
            this.gap12 = gap12;
            this.dv12 = dv12;
            this.dv23 = dv23;
            this.geometryChanged = geometryChanged;
        }
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length != 2) {
            throw new IllegalArgumentException(
                    "Usage: RunStage1TransportBridgeScan <master.mph> <stage1-root>");
        }
        File master = new File(args[0]).getAbsoluteFile();
        File root = new File(args[1]).getAbsoluteFile();
        File out = new File(root, "intermediate/results/transport_bridge_cases");
        Model model = ModelUtil.load("Stage1TransportBridgeScan", master.getAbsolutePath());

        CaseSpec[] cases = new CaseSpec[] {
                new CaseSpec("bridge_gap40p1_V23_5kV", "3e23[1/m^3]", "0.10", "40.1[mm]",
                        "0.5[kV]", "5[kV]", true),
                new CaseSpec("bridge_gap40p2_V23_5kV", "3e23[1/m^3]", "0.10", "40.2[mm]",
                        "0.5[kV]", "5[kV]", true),
                new CaseSpec("bridge_gap40p3_V23_5kV", "3e23[1/m^3]", "0.10", "40.3[mm]",
                        "0.5[kV]", "5[kV]", true),
                new CaseSpec("bridge_gap40p4_V23_5kV", "3e23[1/m^3]", "0.10", "40.4[mm]",
                        "0.5[kV]", "5[kV]", true),
                new CaseSpec("bridge_gap40p5_V23_5kV", "3e23[1/m^3]", "0.10", "40.5[mm]",
                        "0.5[kV]", "5[kV]", true),
                new CaseSpec("bridge_gap40p4_V23_8kV", "3e23[1/m^3]", "0.10", "40.4[mm]",
                        "0.5[kV]", "8[kV]", true),
                new CaseSpec("bridge_gap40p4_V23_10kV", "3e23[1/m^3]", "0.10", "40.4[mm]",
                        "0.5[kV]", "10[kV]", true),
                new CaseSpec("bridge_gap40p4_source0p05_V23_5kV", "3e23[1/m^3]", "0.05", "40.4[mm]",
                        "0.5[kV]", "5[kV]", true),
                new CaseSpec("bridge_gap40p4_source0p075_V23_5kV", "3e23[1/m^3]", "0.075", "40.4[mm]",
                        "0.5[kV]", "5[kV]", true),
                new CaseSpec("bridge_gap40p4_n1e23_V23_5kV", "1e23[1/m^3]", "0.10", "40.4[mm]",
                        "0.5[kV]", "5[kV]", true),
                new CaseSpec("bridge_gap40p4_V12_1kV_V23_5kV", "3e23[1/m^3]", "0.10", "40.4[mm]",
                        "1[kV]", "5[kV]", true),
                new CaseSpec("bridge_gap40p4_V12_2kV_V23_5kV", "3e23[1/m^3]", "0.10", "40.4[mm]",
                        "2[kV]", "5[kV]", true)
        };

        for (CaseSpec spec : cases) {
            System.out.println("BRIDGE_CASE_START=" + spec.name);
            try {
                setCase(model, spec.density, spec.fraction, spec.gap12, spec.dv12, spec.dv23);
                model.component("comp1").geom("geom1").run();
                model.component("comp1").mesh("mesh1").run();
                model.study("std_es").run();
                model.study("std_single").run();
                model.result().numerical("gev_particle").setResult();
                model.result().table("tbl_particle").save(path(out, spec.name + "_timeseries.csv"));
                model.result().numerical("gev_field").setResult();
                model.result().table("tbl_field").save(path(out, spec.name + "_field.csv"));
                System.out.println("BRIDGE_CASE_COMPLETE=" + spec.name);
            } catch (Exception ex) {
                System.out.println("BRIDGE_CASE_FAILED=" + spec.name + " :: " + ex);
            }
        }
        model.save(path(root, "temporary/results/stage1_3d_after_transport_bridge.mph"));
        System.out.println("CHECKPOINT_TRANSPORT_BRIDGE_SAVED="
                + path(root, "temporary/results/stage1_3d_after_transport_bridge.mph"));
        System.out.println("TRANSPORT_BRIDGE_COMPLETE");
    }
}
