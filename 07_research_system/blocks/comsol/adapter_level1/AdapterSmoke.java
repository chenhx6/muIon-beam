import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;
public final class AdapterSmoke {
  public static void main(String[] args) throws Exception {
    System.out.println("COMSOL_JAVA_ENTRYPOINT_START");
    System.out.println("ARG_COUNT=" + (args == null ? -1 : args.length));
    Model model = ModelUtil.create("AdapterSmoke");
    model.label("muIon COMSOL adapter smoke");
    model.comments("Runtime and Java API gate; no physics result claimed.");
    model.save(args.length > 0 ? args[0] : "adapter_smoke.mph");
    System.out.println("MODEL_SAVE_OK=" + (args.length > 0 ? args[0] : "adapter_smoke.mph"));
    System.out.println("COMSOL_JAVA_ENTRYPOINT_COMPLETE");
  }
}
