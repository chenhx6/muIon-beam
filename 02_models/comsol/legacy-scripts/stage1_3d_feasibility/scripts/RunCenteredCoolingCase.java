import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;

/**
 * Re-run the solved centered-source calibration model at one Ne density.
 *
 * The model is intentionally loaded for each case by the launcher.  This
 * avoids carrying a stale particle solution or a parameterized-study state
 * between density points and makes a case independently reproducible.
 */
public final class RunCenteredCoolingCase {
    private RunCenteredCoolingCase() {}

    private static void exportParticle(Model model, String tag, String tableTag,
                                       String expr, String output) {
        // Tags are case-unique.  A fresh MPH load therefore has no collision
        // with these evaluation features.
        model.result().numerical().create(tag, "Particle");
        model.result().numerical(tag).set("data", "part_cooling");
        model.result().numerical(tag).set("expr", expr);
        model.result().numerical(tag).set("evaluate", "all");
        model.result().numerical(tag).set("innerinput", "all");
        model.result().table().create(tableTag, "Table");
        model.result().numerical(tag).set("table", tableTag);
        model.result().numerical(tag).setResult();
        model.result().table(tableTag).save(output);
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length < 4) {
            throw new IllegalArgumentException(
                    "Usage: RunCenteredCoolingCase <calibration.mph> <density[1/m^3]> <output-dir> <case-id>");
        }
        String mph = args[0];
        String density = args[1];
        File out = new File(args[2]).getAbsoluteFile();
        String caseId = args[3];

        Model model = ModelUtil.load("CenteredCoolingCase_" + caseId, mph);
        model.param().set("Ne_number_density", density + "[1/m^3]");
        // Keep the requested 100 ns horizon and 0.1 ns output cadence even
        // when the input MPH was opened after an interrupted export.
        model.param().set("t_end", "100[ns]");
        model.param().set("dt_output", "0.1[ns]");
        model.study("std_cooling").feature("time")
                .set("tlist", "range(0,dt_output,t_end)");

        System.out.println("CENTERED_COOLING_CASE=" + caseId);
        System.out.println("CENTERED_COOLING_DENSITY=" + density);
        model.study("std_cooling").run();
        System.out.println("CENTERED_COOLING_CASE_SOLVED=true");

        exportParticle(model, "pev_case_kperp", "tbl_case_kperp",
                "Kperp_eV", new File(out, "Kperp_eV.csv").getAbsolutePath());
        exportParticle(model, "pev_case_ktotal", "tbl_case_ktotal",
                "Ktotal_eV", new File(out, "Ktotal_eV.csv").getAbsolutePath());
        exportParticle(model, "pev_case_qx", "tbl_case_qx",
                "qx", new File(out, "qx.csv").getAbsolutePath());
        exportParticle(model, "pev_case_qy", "tbl_case_qy",
                "qy", new File(out, "qy.csv").getAbsolutePath());
        exportParticle(model, "pev_case_qz", "tbl_case_qz",
                "qz", new File(out, "qz.csv").getAbsolutePath());
        exportParticle(model, "pev_case_vx", "tbl_case_vx",
                "cpt.vx", new File(out, "vx.csv").getAbsolutePath());
        exportParticle(model, "pev_case_vy", "tbl_case_vy",
                "cpt.vy", new File(out, "vy.csv").getAbsolutePath());
        exportParticle(model, "pev_case_vz", "tbl_case_vz",
                "cpt.vz", new File(out, "vz.csv").getAbsolutePath());

        System.out.println("CENTERED_COOLING_CASE_COMPLETE=true");
    }
}
