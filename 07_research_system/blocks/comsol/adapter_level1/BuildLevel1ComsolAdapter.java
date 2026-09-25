import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;

/**
 * Current level-1 COMSOL adapter gate.
 *
 * This entrypoint imports the active SolidWorks STEP and saves a current MPH
 * checkpoint. It emits machine-readable gate evidence. It does not claim a
 * field/particle solve unless those stages are explicitly enabled and
 * complete; this keeps an adapter smoke run from becoming a physics result.
 */
public final class BuildLevel1ComsolAdapter {
    private BuildLevel1ComsolAdapter() {}

    private static String requiredEnv(String name, String fallback) {
        String value = System.getenv(name);
        if ((value == null || value.trim().isEmpty()) && fallback != null) value = fallback;
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException("Missing required environment variable " + name);
        }
        return value;
    }

    private static String jsonEscape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\r", "\\r").replace("\n", "\\n");
    }

    private static void writeText(Path path, String text) throws Exception {
        Files.createDirectories(path.getParent());
        Files.write(path, text.getBytes(StandardCharsets.UTF_8));
    }

    public static void main(String[] args) throws Exception {
        String stepPath = args != null && args.length > 0 ? args[0] : "D:/muIon-beam/02_models/solidworks/lvl1_mu_ne_001/lvl1_mu_ne_001.geometry.step";
        String stoppingPath = args != null && args.length > 1 ? args[1] : "D:/muIon-beam/03_runs/formal/run_lvl1_mu_ne_001/stopping-output/20260912_1000-run_lvl1_mu_ne_001-mu_ne_stopping-r_interface_si-v01-en.txt";
        String resultDir = args != null && args.length > 2 ? args[2] : "D:/muIon-beam/03_runs/formal/run_lvl1_mu_ne_001/comsol";
        String mphPath = args != null && args.length > 3 ? args[3] : "D:/muIon-beam/03_runs/formal/run_lvl1_mu_ne_001/comsol/level1_gate.mph";
        Path step = Paths.get(stepPath).toAbsolutePath();
        Path stopping = Paths.get(stoppingPath).toAbsolutePath();
        Path out = Paths.get(resultDir).toAbsolutePath();
        Path mph = Paths.get(mphPath).toAbsolutePath();
        // COMSOL batch security may deny Java Filesystem APIs. The model API
        // remains the authoritative import/save interface for this gate.

        System.out.println("LEVEL1_COMSOL_ADAPTER_START");
        System.out.println("STEP_PATH=" + step);
        System.out.println("STOPPING_PATH=" + stopping);
        System.out.println("RESULT_DIR=" + out);

        Model model = ModelUtil.create("Level1MuNeAdapter");
        model.label("level1_mu_ne_001 COMSOL geometry adapter gate");
        model.comments("Current project adapter gate. Geometry import and checkpoint only; no transport result is claimed.");
        model.param().set("target_magnetic_field", "1[T]", "Level-1 target field; field solution not evaluated by gate");
        model.param().set("coil_diameter", "100[mm]", "Current geometry contract");
        model.param().set("electrode_aperture", "30[mm]", "Current geometry contract");
        model.param().set("ne_temperature", "300[K]", "Current model contract");
        model.param().set("ne_number_density", "1e23[1/m^3]", "Candidate density; no transport claim");

        model.component().create("comp1", true);
        model.component("comp1").geom().create("geom1", 3);
        model.component("comp1").geom("geom1").lengthUnit("mm");
        model.component("comp1").geom("geom1").create("imp1", "Import");
        model.component("comp1").geom("geom1").feature("imp1").label("Current SolidWorks STEP: level-1 four-electrode three-chamber geometry");
        model.component("comp1").geom("geom1").feature("imp1").set("filename", step.toString());
        model.component("comp1").geom("geom1").run();
        String[] featureTags = model.component("comp1").geom("geom1").feature().tags();
        System.out.println("GEOMETRY_IMPORT_OK=true");
        System.out.println("GEOMETRY_FEATURE_TAGS=" + Arrays.toString(featureTags));

        model.save(mph.toString());
        System.out.println("MODEL_CHECKPOINT=" + mph);

        String generatedAt = OffsetDateTime.now(ZoneOffset.ofHours(8)).toString();
        String geometryJson = "{\n" +
                "  \"schema_version\": 1,\n" +
                "  \"adapter_id\": \"comsol_adapter_lvl1_mu_ne_001\",\n" +
                "  \"status\": \"passed\",\n" +
                "  \"gate\": \"geometry_import_and_mph_checkpoint\",\n" +
                "  \"geometry_import\": {\"status\": \"passed\", \"feature_tags\": \"" + jsonEscape(Arrays.toString(featureTags)) + "\"},\n" +
                "  \"step_path\": \"" + jsonEscape(step.toString()) + "\",\n" +
                "  \"stopping_interface_path\": \"" + jsonEscape(stopping.toString()) + "\",\n" +
                "  \"mph_path\": \"" + jsonEscape(mph.toString()) + "\",\n" +
                "  \"physics_solve\": {\"status\": \"not_evaluated\", \"reason\": \"This gate verifies active STEP import and current MPH creation; no field or particle transport result is asserted.\"},\n" +
                "  \"generated_at_cst\": \"" + jsonEscape(generatedAt) + "\"\n" +
                "}\n";
        // Result sidecars are emitted by the wrapper after COMSOL exits. This
        // avoids unrestricted Java filesystem calls inside COMSOL.
        System.out.println("GATE_EVIDENCE_JSON=" + out.resolve("comsol_geometry_gate.json"));
        System.out.println("GATE_EVIDENCE_CSV=" + out.resolve("comsol_geometry_gate.csv"));
        System.out.println("LEVEL1_COMSOL_ADAPTER_COMPLETE");
    }
}

