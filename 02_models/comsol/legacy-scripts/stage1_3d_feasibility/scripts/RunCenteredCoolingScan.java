import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;

/**
 * Density sweep for Phase A.  The loaded MPH already contains the imported
 * Geant4 stopping interpolation, centered 500-particle release, and the
 * 0--100 ns transient study.  Only the Ne density is changed between solves.
 */
public final class RunCenteredCoolingScan {
    private RunCenteredCoolingScan() {}

    private static void makeEval(Model model, String tag, String tableTag, String expr) {
        model.result().numerical().create(tag, "Particle");
        model.result().numerical(tag).set("data", "part_cooling");
        model.result().numerical(tag).set("expr", expr);
        model.result().numerical(tag).set("evaluate", "all");
        model.result().numerical(tag).set("innerinput", "all");
        model.result().table().create(tableTag, "Table");
        model.result().numerical(tag).set("table", tableTag);
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length < 3) {
            throw new IllegalArgumentException(
                    "Usage: RunCenteredCoolingScan <calibration.mph> <output-root> <density1,density2,...>");
        }
        String mph = args[0];
        File outputRoot = new File(args[1]).getAbsoluteFile();
        String[] densities = args[2].split(",");
        Model model = ModelUtil.load("CenteredCoolingDensityScan", mph);
        model.param().set("t_end", "100[ns]");
        model.param().set("dt_output", "0.1[ns]");
        model.study("std_cooling").feature("time")
                .set("tlist", "range(0,dt_output,t_end)");

        makeEval(model, "pev_scan_kperp", "tbl_scan_kperp", "Kperp_eV");
        makeEval(model, "pev_scan_ktotal", "tbl_scan_ktotal", "Ktotal_eV");
        makeEval(model, "pev_scan_qx", "tbl_scan_qx", "qx");
        makeEval(model, "pev_scan_qy", "tbl_scan_qy", "qy");
        makeEval(model, "pev_scan_qz", "tbl_scan_qz", "qz");

        for (String raw : densities) {
            String density = raw.trim();
            if (density.length() == 0) continue;
            String safe = density.replace("+", "p").replace("-", "m").replace(".", "p");
            File dir = new File(outputRoot, "n_" + safe);
            System.out.println("CENTERED_COOLING_SCAN_BEGIN=" + density);
            try {
                model.param().set("Ne_number_density", density + "[1/m^3]");
                model.study("std_cooling").run();
                model.result().numerical("pev_scan_kperp").setResult();
                model.result().table("tbl_scan_kperp").save(new File(dir, "Kperp_eV.csv").getAbsolutePath());
                model.result().numerical("pev_scan_ktotal").setResult();
                model.result().table("tbl_scan_ktotal").save(new File(dir, "Ktotal_eV.csv").getAbsolutePath());
                model.result().numerical("pev_scan_qx").setResult();
                model.result().table("tbl_scan_qx").save(new File(dir, "qx.csv").getAbsolutePath());
                model.result().numerical("pev_scan_qy").setResult();
                model.result().table("tbl_scan_qy").save(new File(dir, "qy.csv").getAbsolutePath());
                model.result().numerical("pev_scan_qz").setResult();
                model.result().table("tbl_scan_qz").save(new File(dir, "qz.csv").getAbsolutePath());
                System.out.println("CENTERED_COOLING_SCAN_DONE=" + density);
            } catch (Exception ex) {
                System.out.println("CENTERED_COOLING_SCAN_FAIL=" + density + " :: " + ex);
            }
        }
        System.out.println("CENTERED_COOLING_SCAN_COMPLETE=true");
    }
}
