import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;

/** Minimal fixed-grid Muon_Ensemble solve for transport-survival diagnostics. */
public final class RunStage1Ensemble {
    private RunStage1Ensemble() {}

    private static String path(File dir, String name) {
        return new File(dir, name).getAbsolutePath();
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length != 2) {
            throw new IllegalArgumentException("Usage: RunStage1Ensemble <master.mph> <stage1-root>");
        }
        File master = new File(args[0]).getAbsoluteFile();
        File root = new File(args[1]).getAbsoluteFile();
        File out = new File(root, "intermediate/results/ensemble_500ns");
        Model model = ModelUtil.load("Stage1Ensemble", master.getAbsolutePath());

        model.param().set("Ne_number_density", "1e23[1/m^3]");
        model.param().set("source_radial_fraction_of_gas_radius", "0.50");
        model.param().set("source_fraction_between_V1_V2", "0.5");
        model.param().set("initial_tangential_speed", "0*initial_radial_speed");
        model.param().set("voltage_difference_V1_to_V2", "0.5[kV]");
        model.param().set("voltage_difference_V2_to_V3", "2[kV]");
        model.param().set("voltage_difference_V3_to_V4", "-1.5[kV]");
        model.param().set("V1_to_V2_clear_spacing", "130[mm]");
        model.param().set("V2_to_V3_clear_spacing", "220[mm]");
        model.param().set("V3_to_V4_clear_spacing", "160[mm]");
        model.param().set("ensemble_t_end", "500[ns]");

        // Five-by-five fixed position grid (25 particles), centered on the
        // baseline source.  The release direction remains radial inward.
        model.component("comp1").physics("cpt").feature("rel1")
                .set("GridType", "AllCombinations");
        model.component("comp1").physics("cpt").feature("rel1").set("x0", new String[] {
                "source_x+range(-0.5[mm],0.25[mm],0.5[mm])",
                "source_y+range(-0.5[mm],0.25[mm],0.5[mm])",
                "source_z"});
        model.component("comp1").physics("cpt").feature("rel1").set("v0", new String[] {
                "-initial_radial_speed", "initial_tangential_speed", "initial_axial_speed"});

        System.out.println("ENSEMBLE_RELEASE_GRID=5x5=25_FIXED_PARTICLES_TEND=500ns");
        model.study("std_es").run();
        System.out.println("CHECKPOINT_ENSEMBLE_FIELD_SOLVED");
        model.study("std_ensemble").run();
        System.out.println("CHECKPOINT_ENSEMBLE_SOLVED");

        model.result().dataset().create("dset_ensemble", "Solution");
        model.result().dataset("dset_ensemble").label("Ensemble solution dataset");
        model.result().dataset("dset_ensemble").set("solution", "sol3");
        model.result().table().create("tbl_ensemble", "Table");
        model.result().table("tbl_ensemble").label("Muon_Ensemble aggregate time series");
        model.result().numerical().create("gev_ensemble", "EvalGlobal");
        model.result().numerical("gev_ensemble").set("data", "dset_ensemble");
        model.result().numerical("gev_ensemble").set("expr", new String[] {
                "cpt.ave(qx)", "cpt.ave(qy)", "cpt.ave(qz)",
                "cpt.ave(cpt.vx)", "cpt.ave(cpt.vy)", "cpt.ave(cpt.vz)",
                "cpt.ave(Kperp_J)", "cpt.ave(Kz_J)", "cpt.ave(Ktotal_J)",
                "cpt.ave(radial_position)", "cpt.ave(is_exit)",
                "cpt.ave(is_wall)", "cpt.ave(is_electrode)", "cpt.ave(is_backward)"});
        model.result().numerical("gev_ensemble").set("unit", new String[] {
                "m", "m", "m", "m/s", "m/s", "m/s", "eV", "eV", "eV", "m",
                "1", "1", "1", "1"});
        model.result().numerical("gev_ensemble").set("table", "tbl_ensemble");
        model.result().numerical("gev_ensemble").setResult();
        model.result().table("tbl_ensemble").save(path(out, "ensemble_timeseries.csv"));
        model.save(path(root, "temporary/results/stage1_3d_ensemble_baseline.mph"));
        System.out.println("ENSEMBLE_TABLE=" + path(out, "ensemble_timeseries.csv"));
        System.out.println("CHECKPOINT_ENSEMBLE_SAVED="
                + path(root, "temporary/results/stage1_3d_ensemble_baseline.mph"));
        System.out.println("ENSEMBLE_COMPLETE");
    }
}
