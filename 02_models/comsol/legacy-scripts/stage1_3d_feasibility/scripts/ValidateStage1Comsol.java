import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;
import java.util.Arrays;

/** Read-only COMSOL batch reload validation for the canonical Stage1 MPH. */
public final class ValidateStage1Comsol {
    private ValidateStage1Comsol() {}

    public static void main(String[] args) throws Exception {
        if (args == null || args.length != 1) {
            throw new IllegalArgumentException("Usage: ValidateStage1Comsol <stage1_3d_feasibility.mph>");
        }
        Model model = ModelUtil.load("Stage1_3D_ReloadValidation", args[0]);
        System.out.println("RELOAD_OK=true");
        System.out.println("COMPONENTS=" + Arrays.toString(model.component().tags()));
        System.out.println("GEOMETRY_FEATURES=" + Arrays.toString(
                model.component("comp1").geom("geom1").feature().tags()));
        System.out.println("PHYSICS=" + Arrays.toString(model.component("comp1").physics().tags()));
        for (String physics : model.component("comp1").physics().tags()) {
            System.out.println("PHYSICS_FEATURES=" + physics + ":" + Arrays.toString(
                    model.component("comp1").physics(physics).feature().tags()));
        }
        System.out.println("FUNCTIONS=" + Arrays.toString(model.func().tags()));
        System.out.println("STUDIES=" + Arrays.toString(model.study().tags()));
        System.out.println("SOLUTIONS=" + Arrays.toString(model.sol().tags()));
        System.out.println("DATASETS=" + Arrays.toString(model.result().dataset().tags()));
        System.out.println("RESULT_GROUPS=" + Arrays.toString(model.result().tags()));
        System.out.println("HAS_SN_FUNCTION=" + model.func().hasTag("intSN"));
        System.out.println("HAS_ELECTROSTATICS=" + model.component("comp1").physics().hasTag("es"));
        System.out.println("HAS_CPT=" + model.component("comp1").physics().hasTag("cpt"));
        System.out.println("HAS_SINGLE_STUDY=" + model.study().hasTag("std_single"));
        System.out.println("HAS_ENSEMBLE_STUDY=" + model.study().hasTag("std_ensemble"));
        System.out.println("RELOAD_VALIDATION_COMPLETE");
    }
}
