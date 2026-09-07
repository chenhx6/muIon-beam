import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;
import java.util.Arrays;

/** Read-only transfer check: import the verified SolidWorks STEP into COMSOL. */
public final class ImportStage1SolidWorksStep {
    private ImportStage1SolidWorksStep() {}

    public static void main(String[] args) throws Exception {
        if (args == null || args.length != 3) {
            throw new IllegalArgumentException(
                    "Usage: ImportStage1SolidWorksStep <step> <output-mph> <log-file>");
        }
        String step = new File(args[0]).getAbsolutePath();
        String output = new File(args[1]).getAbsolutePath();
        Model model = ModelUtil.create("Stage1StepImportCheck");
        model.label("Stage1 SolidWorks STEP import check");
        model.comments("Transfer validation only. Final solved physics model remains stage1_3d_feasibility.mph.");
        model.component().create("comp1", true);
        model.component("comp1").geom().create("geom1", 3);
        model.component("comp1").geom("geom1").lengthUnit("mm");
        model.component("comp1").geom("geom1").create("imp1", "Import");
        model.component("comp1").geom("geom1").feature("imp1").label("SolidWorks Stage1_Master_3D STEP");
        model.component("comp1").geom("geom1").feature("imp1").set("filename", step);
        model.component("comp1").geom("geom1").run();
        System.out.println("STEP_IMPORT=SUCCESS");
        System.out.println("STEP_PATH=" + step);
        System.out.println("GEOMETRY_FEATURES=" + Arrays.toString(
                model.component("comp1").geom("geom1").feature().tags()));
        model.save(output);
        System.out.println("OUTPUT_MPH=" + output);
        System.out.println("STEP_IMPORT_CHECK_COMPLETE");
    }
}
