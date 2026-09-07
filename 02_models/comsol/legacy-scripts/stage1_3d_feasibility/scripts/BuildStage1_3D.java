import com.comsol.model.Model;
import com.comsol.model.util.ModelUtil;

import java.io.File;
import java.util.Arrays;

/**
 * COMSOL 6.4 Java-API builder for the Stage-1 3-D feasibility model.
 *
 * The geometry is a parameterized 3-D master-like model built from analytic
 * primitives.  The four finite-thickness annular electrodes are rounded with
 * Fillet3D.  The model intentionally keeps only the physics-relevant solids:
 * Ne gas, a representative alumina liner, the grounded outer shell boundary,
 * and the four metal electrode solids.
 *
 * Physics warning: the supplied Geant4 table is a mean electromagnetic
 * stopping baseline.  It is not a complete muon-Ne collision, capture, or
 * survival model.
 */
public final class BuildStage1_3D {
    private BuildStage1_3D() {}

    private static String path(File directory, String name) {
        return new File(directory, name).getAbsolutePath();
    }

    private static void label(Model model, String tag, String text) {
        model.component("comp1").geom("geom1").feature(tag).label(text);
    }

    private static void setOptional(Model model, String physicsTag, String property,
                                    String key, String value) {
        try {
            model.component("comp1").physics(physicsTag).prop(property).set(key, value);
        } catch (Exception ignored) {
            System.out.println("OPTIONAL_PROPERTY_SKIPPED=" + physicsTag + "/"
                    + property + "/" + key);
        }
    }

    private static void createCylinder(Model model, String tag, String text,
                                       String radius, String height, String z0,
                                       boolean selectionResult) {
        model.component("comp1").geom("geom1").create(tag, "Cylinder");
        label(model, tag, text);
        model.component("comp1").geom("geom1").feature(tag).set("r", radius);
        model.component("comp1").geom("geom1").feature(tag).set("h", height);
        model.component("comp1").geom("geom1").feature(tag)
                .set("pos", new String[] {"0", "0", z0});
        if (selectionResult) {
            model.component("comp1").geom("geom1").feature(tag).set("selresult", true);
            model.component("comp1").geom("geom1").feature(tag)
                    .set("selresultshow", "all");
        }
    }

    private static void createRoundedElectrode(Model model, String id, String number,
                                               String zCenter, String ringPrefix) {
        String outer = ringPrefix + "_outer";
        String inner = ringPrefix + "_inner";
        String ring = ringPrefix + "_ring";
        String rounded = ringPrefix + "_rounded";
        String z0 = "(" + zCenter + ")-electrode_thickness/2";

        createCylinder(model, outer, "V" + number + " electrode outer blank",
                "electrode_outer_radius", "electrode_thickness", z0, false);
        createCylinder(model, inner, "V" + number + " aperture cutter",
                "electrode_aperture_radius", "electrode_thickness", z0, false);

        model.component("comp1").geom("geom1").create(ring, "Difference");
        label(model, ring, "V" + number + " finite-thickness annular electrode");
        model.component("comp1").geom("geom1").feature(ring)
                .selection("input").set(outer);
        model.component("comp1").geom("geom1").feature(ring)
                .selection("input2").set(inner);
        model.component("comp1").geom("geom1").feature(ring).set("selresult", true);
        model.component("comp1").geom("geom1").feature(ring)
                .set("selresultshow", "all");
        model.component("comp1").geom("geom1").run(ring);

        // Fillet3D with an empty edge list means all valid edges of this ring.
        // For this annular geometry, that rounds the aperture edge as well as
        // the outside edge and avoids a sharp-edge field singularity.
        model.component("comp1").geom("geom1").create(rounded, "Fillet3D");
        label(model, rounded, "V" + number + " electrode, 1 mm rounded edges");
        // COMSOL 6.4 requires an explicit object/dimension tuple for the
        // edge-selection property.  An empty entity list is interpreted as
        // all valid edges of the preceding ring object, as verified by the
        // retained Fillet3D API probe.
        model.component("comp1").geom("geom1").feature(rounded).selection("edge")
                .set(ring, 1, new int[0]);
        model.component("comp1").geom("geom1").feature(rounded)
                .set("radius", "electrode_aperture_edge_round_radius");
        model.component("comp1").geom("geom1").feature(rounded).set("selresult", true);
        model.component("comp1").geom("geom1").feature(rounded)
                .set("selresultshow", "all");
        model.component("comp1").geom("geom1").run(rounded);
        System.out.println("GEOMETRY_ELECTRODE_ROUNDED=" + id);
    }

    private static void createGeometry(Model model) {
        model.component("comp1").geom().create("geom1", 3);
        model.component("comp1").geom("geom1").lengthUnit("mm");

        createCylinder(model, "outer0", "Grounded outer shell / bore boundary",
                "grounded_shell_inner_radius", "Lstage1", "0", true);
        createCylinder(model, "gas0", "Uniform Ne gas volume before electrode subtraction",
                "gas_volume_radius", "Lstage1", "0", true);
        // Keep a second identical cutter because COMSOL boolean features
        // consume their input objects.  gas0 remains available for the
        // particle-domain difference while gas_shell_cut defines the
        // dielectric liner around the bore.
        createCylinder(model, "gas_shell_cut", "Gas cutter reserved for dielectric liner",
                "gas_volume_radius", "Lstage1", "0", false);

        model.component("comp1").geom("geom1").create("diel0", "Difference");
        label(model, "diel0", "Representative alumina dielectric liner");
        model.component("comp1").geom("geom1").feature("diel0")
                .selection("input").set("outer0");
        model.component("comp1").geom("geom1").feature("diel0")
                .selection("input2").set("gas_shell_cut");
        model.component("comp1").geom("geom1").feature("diel0").set("selresult", true);
        model.component("comp1").geom("geom1").feature("diel0")
                .set("selresultshow", "all");

        createRoundedElectrode(model, "V1", "1", "z_V1", "v1");
        createRoundedElectrode(model, "V2", "2", "z_V2", "v2");
        createRoundedElectrode(model, "V3", "3", "z_V3", "v3");
        createRoundedElectrode(model, "V4", "4", "z_V4", "v4");

        model.component("comp1").geom("geom1").create("gaswork", "Difference");
        label(model, "gaswork", "Ne gas domain excluding four electrode solids");
        model.component("comp1").geom("geom1").feature("gaswork")
                .selection("input").set("gas0");
        model.component("comp1").geom("geom1").feature("gaswork")
                .selection("input2").set(new String[] {
                        "v1_rounded", "v2_rounded", "v3_rounded", "v4_rounded"});
        model.component("comp1").geom("geom1").feature("gaswork")
                .set("selresult", true);
        model.component("comp1").geom("geom1").feature("gaswork")
                .set("selresultshow", "all");

        model.component("comp1").geom("geom1").run();
        System.out.println("GEOMETRY_SELECTION_TAGS=" + Arrays.toString(
                model.component("comp1").selection().tags()));

        model.component("comp1").selection().create("sel_es_domains", "Union");
        model.component("comp1").selection("sel_es_domains")
                .label("Electrostatics: Ne gas plus dielectric only");
        model.component("comp1").selection("sel_es_domains").set("entitydim", 3);
        model.component("comp1").selection("sel_es_domains").set("input", new String[] {
                "geom1_gaswork_dom", "geom1_diel0_dom"});

        model.component("comp1").selection().create("sel_cpt_gas", "Explicit");
        model.component("comp1").selection("sel_cpt_gas")
                .label("Charged particle tracing: uniform Ne gas domain");
        model.component("comp1").selection("sel_cpt_gas").geom("geom1", 3);
        model.component("comp1").selection("sel_cpt_gas")
                .set(model.component("comp1").selection("geom1_gaswork_dom").entities());

        model.component("comp1").selection().create("sel_electrodes", "Union");
        model.component("comp1").selection("sel_electrodes")
                .label("All four rounded annular electrode boundaries");
        model.component("comp1").selection("sel_electrodes").set("entitydim", 2);
        model.component("comp1").selection("sel_electrodes").set("input", new String[] {
                "geom1_v1_rounded_bnd", "geom1_v2_rounded_bnd",
                "geom1_v3_rounded_bnd", "geom1_v4_rounded_bnd"});

        System.out.println("GEOMETRY_DOMAINS_GAS=" + Arrays.toString(
                model.component("comp1").selection("geom1_gaswork_dom").entities()));
        System.out.println("GEOMETRY_DOMAINS_DIELECTRIC=" + Arrays.toString(
                model.component("comp1").selection("geom1_diel0_dom").entities()));
        System.out.println("GEOMETRY_BND_V1=" + Arrays.toString(
                model.component("comp1").selection("geom1_v1_rounded_bnd").entities()));
        System.out.println("GEOMETRY_BND_OUTER=" + Arrays.toString(
                model.component("comp1").selection("geom1_outer0_bnd").entities()));
    }

    private static void createMaterials(Model model) {
        model.component("comp1").material().create("mat_gas", "Common");
        model.component("comp1").material("mat_gas")
                .label("Natural Neon gas, representative relative permittivity");
        model.component("comp1").material("mat_gas").selection()
                .named("geom1_gaswork_dom");
        model.component("comp1").material("mat_gas").propertyGroup("def")
                .set("relpermittivity", new String[] {"1.00065", "1.00065", "1.00065"});

        model.component("comp1").material().create("mat_diel", "Common");
        model.component("comp1").material("mat_diel")
                .label("Representative alumina ceramic; epsilon_r=9.4 assumption");
        model.component("comp1").material("mat_diel").selection()
                .named("geom1_diel0_dom");
        model.component("comp1").material("mat_diel").propertyGroup("def")
                .set("relpermittivity", new String[] {"9.4", "9.4", "9.4"});
    }

    private static void addPotential(Model model, String tag, String label,
                                     String selection, String voltage) {
        model.component("comp1").physics("es").create(tag, "ElectricPotential", 2);
        model.component("comp1").physics("es").feature(tag).label(label);
        model.component("comp1").physics("es").feature(tag).selection().named(selection);
        model.component("comp1").physics("es").feature(tag).set("V0", voltage);
    }

    private static void createPhysics(Model model, String stoppingFile) {
        model.component("comp1").physics().create("es", "Electrostatics", "geom1");
        model.component("comp1").physics("es")
                .label("Electrostatics: four finite-thickness rounded ring electrodes");
        model.component("comp1").physics("es").selection().named("sel_es_domains");

        model.component("comp1").physics("es").create("gnd1", "Ground", 2);
        model.component("comp1").physics("es").feature("gnd1")
                .label("Grounded outer shell and axial end boundary");
        model.component("comp1").physics("es").feature("gnd1").selection()
                .named("geom1_outer0_bnd");
        addPotential(model, "pot_v1", "V1 electrode potential", "geom1_v1_rounded_bnd", "V1");
        addPotential(model, "pot_v2", "V2 electrode potential", "geom1_v2_rounded_bnd", "V2");
        addPotential(model, "pot_v3", "V3 electrode potential", "geom1_v3_rounded_bnd", "V3");
        addPotential(model, "pot_v4", "V4 electrode potential", "geom1_v4_rounded_bnd", "V4");

        model.func().create("intSN", "Interpolation");
        model.func("intSN").label("Geant4 11.3.2 mu- Neon SN(E) stopping cross section");
        model.func("intSN").set("source", "file");
        model.func("intSN").set("filename", stoppingFile);
        model.func("intSN").set("nargs", "1");
        model.func("intSN").setIndex("funcs", "SN_muNe", 0, 0);
        model.func("intSN").set("argunit", "eV");
        model.func("intSN").set("fununit", "eV*m^2");

        model.component("comp1").physics().create("cpt", "ChargedParticleTracing", "geom1");
        model.component("comp1").physics("cpt")
                .label("Charged Particle Tracing: mu- full 3-D Lorentz force");
        model.component("comp1").physics("cpt").selection().named("sel_cpt_gas");
        setOptional(model, "cpt", "RelativisticCorrection", "RelativisticCorrection", "0");
        setOptional(model, "cpt", "StoreParticleStatusData", "StoreParticleStatusData", "1");
        setOptional(model, "cpt", "StoreParticleReleaseStatistics",
                "StoreParticleReleaseStatistics", "1");

        model.component("comp1").physics("cpt").feature("pp1")
                .label("User-defined negative muon, q=-e");
        model.component("comp1").physics("cpt").feature("pp1")
                .set("ParticleSpecies", "UserDefined");
        model.component("comp1").physics("cpt").feature("pp1").set("mp", "m_mu");
        model.component("comp1").physics("cpt").feature("pp1").set("Z", "-1");

        model.component("comp1").physics("cpt").create("ef1", "ElectricForce", 3);
        model.component("comp1").physics("cpt").feature("ef1")
                .label("Full 3-D electrostatic force: Ex, Ey, Ez and aperture fringe field");
        model.component("comp1").physics("cpt").feature("ef1").selection()
                .named("sel_cpt_gas");
        model.component("comp1").physics("cpt").feature("ef1")
                .set("SpecifyForceUsing", "ElectricField");
        model.component("comp1").physics("cpt").feature("ef1").set("E", new String[] {
                "root.comp1.es.Ex", "root.comp1.es.Ey", "root.comp1.es.Ez"});

        model.component("comp1").physics("cpt").create("mf1", "MagneticForce", 3);
        model.component("comp1").physics("cpt").feature("mf1")
                .label("Uniform magnetic field Bz=1 T along +z");
        model.component("comp1").physics("cpt").feature("mf1").selection()
                .named("sel_cpt_gas");
        model.component("comp1").physics("cpt").feature("mf1").set("B_src", "userdef");
        model.component("comp1").physics("cpt").feature("mf1").set("B", new String[] {
                "0", "0", "magnetic_field_axial"});

        model.component("comp1").physics("cpt").create("cool1", "Force", 3);
        model.component("comp1").physics("cpt").feature("cool1")
                .label("Geant4 mean electromagnetic stopping force, Ktotal-based");
        model.component("comp1").physics("cpt").feature("cool1").selection()
                .named("sel_cpt_gas");
        model.component("comp1").physics("cpt").feature("cool1")
                .set("SpecifyForce", "Directly");
        model.component("comp1").physics("cpt").feature("cool1").set("F", new String[] {
                "-local_stopping_J_per_m*cpt.vx/particle_speed_smooth",
                "-local_stopping_J_per_m*cpt.vy/particle_speed_smooth",
                "-local_stopping_J_per_m*cpt.vz/particle_speed_smooth"});

        model.component("comp1").physics("cpt").create("rel1", "ReleaseGrid", -1);
        model.component("comp1").physics("cpt").feature("rel1")
                .label("Single muon source at V1/V2 midpoint; radial inward");
        model.component("comp1").physics("cpt").feature("rel1")
                .set("GridType", "AllCombinations");
        model.component("comp1").physics("cpt").feature("rel1")
                .set("x0", new String[] {"source_x", "source_y", "source_z"});
        model.component("comp1").physics("cpt").feature("rel1")
                .set("VelocitySpecification", "SpecifyVelocity");
        model.component("comp1").physics("cpt").feature("rel1")
                .set("InitialVelocity", "Expression");
        model.component("comp1").physics("cpt").feature("rel1")
                .set("v0", new String[] {"-initial_radial_speed", "initial_tangential_speed",
                        "initial_axial_speed"});
        model.component("comp1").physics("cpt").feature("rel1").set("rt", "0");

        model.component("comp1").physics("cpt").feature("wall1")
                .label("Freeze on electrode, dielectric, grounded wall, backward or exit plane");
        model.component("comp1").physics("cpt").feature("wall1")
                .set("WallCondition", "Freeze");
    }

    private static void createVariables(Model model) {
        model.component("comp1").variable().create("var_particle");
        model.component("comp1").variable("var_particle")
                .label("Muon energy and transport diagnostics");
        model.component("comp1").variable("var_particle").set("particle_speed",
                "sqrt(cpt.vx^2+cpt.vy^2+cpt.vz^2)");
        model.component("comp1").variable("var_particle").set("particle_speed_smooth",
                "sqrt(cpt.vx^2+cpt.vy^2+cpt.vz^2+v_floor^2)");
        model.component("comp1").variable("var_particle").set("Kz_J",
                "0.5*m_mu*cpt.vz^2");
        model.component("comp1").variable("var_particle").set("Kperp_J",
                "0.5*m_mu*(cpt.vx^2+cpt.vy^2)");
        model.component("comp1").variable("var_particle").set("Ktotal_J",
                "0.5*m_mu*(cpt.vx^2+cpt.vy^2+cpt.vz^2)");
        model.component("comp1").variable("var_particle").set("Ktotal_eV",
                "Ktotal_J/1[eV]");
        model.component("comp1").variable("var_particle").set("Ktotal_eV_clamped",
                "Ktotal_eV");
        model.component("comp1").variable("var_particle").set("local_stopping_eV_per_m",
                "Ne_number_density*SN_muNe(Ktotal_J)");
        model.component("comp1").variable("var_particle").set("local_stopping_J_per_m",
                "local_stopping_eV_per_m*1.602176634e-19[J/eV]");
        model.component("comp1").variable("var_particle").set("radial_position",
                "sqrt(qx^2+qy^2)");
        model.component("comp1").variable("var_particle").set("E_total_local",
                "sqrt(es.Ex^2+es.Ey^2+es.Ez^2)");
        model.component("comp1").variable("var_particle").set("E_transverse_local",
                "sqrt(es.Ex^2+es.Ey^2)");
        model.component("comp1").variable("var_particle").set("is_exit",
                "if(qz>Lstage1-exit_classification_tolerance,1,0)");
        model.component("comp1").variable("var_particle").set("is_backward",
                "if(qz<exit_classification_tolerance,1,0)");
        model.component("comp1").variable("var_particle").set("is_wall",
                "if(radial_position>gas_volume_radius-exit_classification_tolerance,1,0)");
        model.component("comp1").variable("var_particle").set("is_electrode",
                "if((radial_position>electrode_aperture_radius-exit_classification_tolerance)"
                + "*(radial_position<electrode_outer_radius+exit_classification_tolerance)"
                + "*((abs(qz-z_V1)<electrode_thickness/2+exit_classification_tolerance)"
                + "+(abs(qz-z_V2)<electrode_thickness/2+exit_classification_tolerance)"
                + "+(abs(qz-z_V3)<electrode_thickness/2+exit_classification_tolerance)"
                + "+(abs(qz-z_V4)<electrode_thickness/2+exit_classification_tolerance))>0,1,0)");

        model.component("comp1").variable().create("var_field");
        model.component("comp1").variable("var_field")
                .label("Electric-field and high-voltage screening diagnostics");
        model.component("comp1").variable("var_field").set("E_total",
                "sqrt(es.Ex^2+es.Ey^2+es.Ez^2)");
        model.component("comp1").variable("var_field").set("E_transverse",
                "sqrt(es.Ex^2+es.Ey^2)");
        model.component("comp1").cpl().create("maxop_es", "Maximum");
        model.component("comp1").cpl("maxop_es").selection().named("sel_es_domains");
        model.component("comp1").cpl().create("maxop_gas", "Maximum");
        model.component("comp1").cpl("maxop_gas").selection().named("geom1_gaswork_dom");
        model.component("comp1").cpl().create("maxop_diel", "Maximum");
        model.component("comp1").cpl("maxop_diel").selection().named("geom1_diel0_dom");
        model.component("comp1").cpl().create("maxop_v1", "Maximum");
        model.component("comp1").cpl("maxop_v1").selection().named("geom1_v1_rounded_bnd");
        model.component("comp1").cpl().create("maxop_v2", "Maximum");
        model.component("comp1").cpl("maxop_v2").selection().named("geom1_v2_rounded_bnd");
        model.component("comp1").cpl().create("maxop_v3", "Maximum");
        model.component("comp1").cpl("maxop_v3").selection().named("geom1_v3_rounded_bnd");
        model.component("comp1").cpl().create("maxop_v4", "Maximum");
        model.component("comp1").cpl("maxop_v4").selection().named("geom1_v4_rounded_bnd");
        model.component("comp1").variable("var_field").set("max_E_total",
                "maxop_es(E_total)");
        model.component("comp1").variable("var_field").set("max_E_in_Ne",
                "maxop_gas(E_total)");
        model.component("comp1").variable("var_field").set("max_E_in_dielectric",
                "maxop_diel(E_total)");
        model.component("comp1").variable("var_field").set("max_E_at_aperture",
                "max(maxop_v1(E_total),max(maxop_v2(E_total),max(maxop_v3(E_total),maxop_v4(E_total))))");
        model.component("comp1").variable("var_field").set("max_E_at_triple_junction",
                "max_E_in_dielectric");
        model.component("comp1").variable("var_field").set("average_E_V1_V2",
                "intop_gas(if((z>z_V1+electrode_thickness/2)*(z<z_V2-electrode_thickness/2),abs(es.Ez),0))"
                + "/intop_gas(if((z>z_V1+electrode_thickness/2)*(z<z_V2-electrode_thickness/2),1,0))");
        model.component("comp1").variable("var_field").set("average_E_V2_V3",
                "intop_gas(if((z>z_V2+electrode_thickness/2)*(z<z_V3-electrode_thickness/2),abs(es.Ez),0))"
                + "/intop_gas(if((z>z_V2+electrode_thickness/2)*(z<z_V3-electrode_thickness/2),1,0))");
        model.component("comp1").variable("var_field").set("average_E_V3_V4",
                "intop_gas(if((z>z_V3+electrode_thickness/2)*(z<z_V4-electrode_thickness/2),abs(es.Ez),0))"
                + "/intop_gas(if((z>z_V3+electrode_thickness/2)*(z<z_V4-electrode_thickness/2),1,0))");
        model.component("comp1").cpl().create("intop_gas", "Integration");
        model.component("comp1").cpl("intop_gas").selection().named("geom1_gaswork_dom");
    }

    private static void createStudies(Model model) {
        model.study().create("std_es");
        model.study("std_es").label("Study 1 - 3D Electrostatics stationary");
        model.study("std_es").create("stat", "Stationary");
        model.study("std_es").feature("stat").setSolveFor("/physics/cpt", false);

        model.study().create("std_single");
        model.study("std_single").label("Study 2 - Single_Muon_Diagnostic");
        model.study("std_single").create("time", "Transient");
        model.study("std_single").feature("time").setSolveFor("/physics/es", false);
        model.study("std_single").feature("time").set("tlist", "range(0,dt_output,t_end)");
        model.study("std_single").feature("time").set("usertol", true);
        model.study("std_single").feature("time").set("rtol", "1e-5");
        model.study("std_single").feature("time").set("usesol", true);
        model.study("std_single").feature("time").set("notsolmethod", "sol");
        model.study("std_single").feature("time").set("notstudy", "std_es");

        model.study().create("std_ensemble");
        model.study("std_ensemble").label("Study 3 - Muon_Ensemble placeholder");
        model.study("std_ensemble").create("time", "Transient");
        model.study("std_ensemble").feature("time").setSolveFor("/physics/es", false);
        model.study("std_ensemble").feature("time").set("tlist", "range(0,dt_output,ensemble_t_end)");
        model.study("std_ensemble").feature("time").set("usertol", true);
        model.study("std_ensemble").feature("time").set("rtol", "3e-5");
        model.study("std_ensemble").feature("time").set("usesol", true);
        model.study("std_ensemble").feature("time").set("notsolmethod", "sol");
        model.study("std_ensemble").feature("time").set("notstudy", "std_es");
    }

    private static void addImageExport(Model model, String tag, String plotGroup,
                                       File outputDirectory, String filename,
                                       int width, int height) {
        model.result().export().create(tag, "Image");
        model.result().export(tag).set("sourceobject", plotGroup);
        model.result().export(tag).set("imagetype", "png");
        model.result().export(tag).set("pngfilename", path(outputDirectory, filename));
        model.result().export(tag).set("size", "manualweb");
        model.result().export(tag).set("width", Integer.toString(width));
        model.result().export(tag).set("height", Integer.toString(height));
        model.result().export(tag).set("zoomextents", "on");
    }

    private static void createResults(Model model, File plots, File tables) {
        model.result().dataset().create("part1", "Particle");
        model.result().dataset("part1").label("3D muon trajectories from Single_Muon_Diagnostic");
        model.result().dataset("part1").set("solution", "sol2");
        model.result().dataset("part1").set("posdof", new String[] {
                "comp1.qx", "comp1.qy", "comp1.qz"});
        model.result().dataset("part1").set("geom", "geom1");
        model.result().dataset("part1").set("pgeom", "pgeom_cpt");
        model.result().dataset("part1").set("pgeomspec", "fromphysics");
        model.result().dataset("part1").set("physicsinterface", "cpt");

        model.result().create("pg_geometry", "PlotGroup3D");
        model.result("pg_geometry").label("Stage1 3D geometry cutaway / external surfaces");
        model.result("pg_geometry").set("data", "dset1");
        model.result("pg_geometry").feature().create("surf1", "Surface");
        model.result("pg_geometry").feature("surf1").set("expr", "1");
        model.result("pg_geometry").feature("surf1").set("rangecoloractive", false);

        model.result().create("pg_field", "PlotGroup3D");
        model.result("pg_field").label("3D electric-field magnitude with real fringe field");
        model.result("pg_field").set("data", "dset1");
        model.result("pg_field").feature().create("slc1", "Slice");
        model.result("pg_field").feature("slc1").set("expr", "E_total");
        model.result("pg_field").feature("slc1").set("quickplane", "zx");

        model.result().create("pg_potential", "PlotGroup3D");
        model.result("pg_potential").label("3D electrostatic potential section");
        model.result("pg_potential").set("data", "dset1");
        model.result("pg_potential").feature().create("slc1", "Slice");
        model.result("pg_potential").feature("slc1").set("expr", "V");
        model.result("pg_potential").feature("slc1").set("quickplane", "zx");

        model.result().create("pg_traj", "PlotGroup3D");
        model.result("pg_traj").label("Single muon 3D trajectory over Stage1 geometry");
        model.result("pg_traj").set("data", "part1");
        model.result("pg_traj").feature().create("traj1", "ParticleTrajectories");

        model.result().dataset().create("cln_axis", "CutLine3D");
        model.result().dataset("cln_axis").label("Axis line r=0, y=0");
        model.result().dataset("cln_axis").set("data", "dset1");
        model.result().dataset("cln_axis").set("genpoints", new String[][] {
                {"0", "0", "0"}, {"0", "0", "Lstage1"}});

        model.result().create("pg_axis", "PlotGroup1D");
        model.result("pg_axis").label("Axis potential and Ez");
        model.result("pg_axis").set("data", "cln_axis");
        model.result("pg_axis").feature().create("lngrV", "LineGraph");
        model.result("pg_axis").feature("lngrV").set("expr", "V");
        model.result("pg_axis").feature().create("lngrEz", "LineGraph");
        model.result("pg_axis").feature("lngrEz").set("expr", "es.Ez");

        model.result().create("pg_energy", "PlotGroup1D");
        model.result("pg_energy").label("Single muon Kperp, Kz and Ktotal");
        model.result("pg_energy").set("data", "dset2");
        model.result("pg_energy").feature().create("glob1", "Global");
        model.result("pg_energy").feature("glob1").set("expr", new String[] {
                "cpt.ave(Kperp_J)", "cpt.ave(Kz_J)", "cpt.ave(Ktotal_J)"});
        model.result("pg_energy").feature("glob1").set("unit", new String[] {"eV", "eV", "eV"});
        model.result("pg_energy").feature("glob1").set("descr", new String[] {
                "Kperp", "Kz", "Ktotal"});

        model.result().create("pg_position", "PlotGroup1D");
        model.result("pg_position").label("Single muon position and radial envelope");
        model.result("pg_position").set("data", "dset2");
        model.result("pg_position").feature().create("glob1", "Global");
        model.result("pg_position").feature("glob1").set("expr", new String[] {
                "cpt.ave(radial_position)", "cpt.ave(qz)"});
        model.result("pg_position").feature("glob1").set("unit", new String[] {"m", "m"});

        model.result().table().create("tbl_field", "Table");
        model.result().table("tbl_field").label("3D electric field / HV screening summary");
        model.result().numerical().create("gev_field", "EvalGlobal");
        model.result().numerical("gev_field").set("data", "dset1");
        model.result().numerical("gev_field").set("expr", new String[] {
                "max_E_total", "max_E_in_Ne", "max_E_in_dielectric",
                "max_E_at_aperture", "max_E_at_triple_junction",
                "average_E_V1_V2", "average_E_V2_V3", "average_E_V3_V4"});
        model.result().numerical("gev_field").set("unit", new String[] {
                "V/m", "V/m", "V/m", "V/m", "V/m", "V/m", "V/m", "V/m"});
        model.result().numerical("gev_field").set("table", "tbl_field");

        model.result().table().create("tbl_particle", "Table");
        model.result().table("tbl_particle").label("Single muon 3D time series");
        model.result().numerical().create("gev_particle", "EvalGlobal");
        model.result().numerical("gev_particle").set("data", "dset2");
        model.result().numerical("gev_particle").set("expr", new String[] {
                "cpt.ave(qx)", "cpt.ave(qy)", "cpt.ave(qz)",
                "cpt.ave(cpt.vx)", "cpt.ave(cpt.vy)", "cpt.ave(cpt.vz)",
                "cpt.ave(Kperp_J)", "cpt.ave(Kz_J)", "cpt.ave(Ktotal_J)",
                "cpt.ave(radial_position)", "cpt.ave(E_total_local)",
                "cpt.ave(E_transverse_local)", "cpt.ave(local_stopping_eV_per_m)",
                "cpt.ave(is_exit)", "cpt.ave(is_wall)", "cpt.ave(is_electrode)",
                "cpt.ave(is_backward)"});
        model.result().numerical("gev_particle").set("unit", new String[] {
                "m", "m", "m", "m/s", "m/s", "m/s", "eV", "eV", "eV", "m",
                "V/m", "V/m", "eV/m", "1", "1", "1", "1"});
        model.result().numerical("gev_particle").set("table", "tbl_particle");

        addImageExport(model, "img_geometry", "pg_geometry", plots,
                "stage1_3d_geometry_external.png", 1800, 1200);
        addImageExport(model, "img_field", "pg_field", plots,
                "electric_field_section.png", 1800, 1200);
        addImageExport(model, "img_potential", "pg_potential", plots,
                "potential_section.png", 1800, 1200);
        addImageExport(model, "img_traj", "pg_traj", plots,
                "single_muon_trajectory_3d.png", 1800, 1200);
        addImageExport(model, "img_axis", "pg_axis", plots,
                "axis_potential_field.png", 1800, 1000);
        addImageExport(model, "img_energy", "pg_energy", plots,
                "single_muon_energy_evolution.png", 1800, 1000);
        addImageExport(model, "img_position", "pg_position", plots,
                "single_muon_position_evolution.png", 1800, 1000);
    }

    private static void setParameters(Model model) {
        model.param().set("m_mu", "1.8835315557426432e-28[kg]",
                "CONFIRMED reliable negative-muon mass");
        model.param().set("q_mu", "-e_const", "CONFIRMED q_mu=-e");
        model.param().set("magnetic_field_axial", "1[T]",
                "CONFIRMED uniform +z magnetic field");
        model.param().set("solenoid_bore_inner_diameter", "100[mm]",
                "CONFIRMED effective solenoid bore scale");
        model.param().set("grounded_shell_inner_diameter", "100[mm]",
                "ENGINEERING_ASSUMPTION: grounded safety shell inner diameter");
        model.param().set("grounded_shell_radial_wall_thickness", "5[mm]",
                "TEST_ONLY representative shell thickness");
        model.param().set("grounded_shell_inner_radius",
                "grounded_shell_inner_diameter/2", "Derived grounded shell radius");
        model.param().set("grounded_shell_outer_radius",
                "grounded_shell_inner_radius+grounded_shell_radial_wall_thickness",
                "Derived outer shell radius");
        model.param().set("dielectric_liner_radial_thickness", "5[mm]",
                "TEST_ONLY representative alumina liner thickness");
        model.param().set("gas_volume_radius",
                "grounded_shell_inner_radius-dielectric_liner_radial_thickness",
                "Derived uniform Ne gas radius");
        model.param().set("electrode_aperture_diameter", "30[mm]",
                "CONFIRMED common aperture diameter");
        model.param().set("electrode_aperture_radius", "electrode_aperture_diameter/2",
                "Derived aperture radius");
        model.param().set("electrode_thickness", "3[mm]",
                "TEST_ONLY baseline finite thickness");
        model.param().set("electrode_aperture_edge_round_radius", "1[mm]",
                "TEST_ONLY baseline aperture/edge rounding");
        model.param().set("electrode_outer_diameter", "80[mm]",
                "TEST_ONLY baseline electrode outside diameter");
        model.param().set("electrode_outer_radius", "electrode_outer_diameter/2",
                "Derived electrode outer radius");
        model.param().set("electrode_to_ground_radial_clearance",
                "grounded_shell_inner_radius-electrode_outer_radius",
                "Derived radial electrode-to-ground allowance");

        model.param().set("stage1_entrance_margin", "25[mm]",
                "PRE_SCAN_DERIVED entrance margin");
        model.param().set("V1_to_V2_clear_spacing", "130[mm]",
                "PRE_SCAN_DERIVED TEST_ONLY V1-V2 clear spacing");
        model.param().set("V2_to_V3_clear_spacing", "220[mm]",
                "PRE_SCAN_DERIVED TEST_ONLY V2-V3 clear spacing");
        model.param().set("V3_to_V4_clear_spacing", "160[mm]",
                "PRE_SCAN_DERIVED TEST_ONLY V3-V4 clear spacing");
        model.param().set("stage1_exit_margin", "50[mm]",
                "PRE_SCAN_DERIVED exit margin");
        model.param().set("Lstage1", "stage1_entrance_margin+4*electrode_thickness"
                + "+V1_to_V2_clear_spacing+V2_to_V3_clear_spacing"
                + "+V3_to_V4_clear_spacing+stage1_exit_margin",
                "DERIVED stage1_total_length");
        model.param().set("stage1_total_length", "Lstage1",
                "Alias for Lstage1");
        model.param().set("z_V1", "stage1_entrance_margin+electrode_thickness/2",
                "Derived V1 center");
        model.param().set("z_V2", "z_V1+electrode_thickness+V1_to_V2_clear_spacing",
                "Derived V2 center");
        model.param().set("z_V3", "z_V2+electrode_thickness+V2_to_V3_clear_spacing",
                "Derived V3 center");
        model.param().set("z_V4", "z_V3+electrode_thickness+V3_to_V4_clear_spacing",
                "Derived V4 center");

        model.param().set("source_fraction_between_V1_V2", "0.5",
                "CONFIRMED source at V1/V2 axial midpoint");
        model.param().set("source_z", "z_V1+source_fraction_between_V1_V2"
                + "*(electrode_thickness+V1_to_V2_clear_spacing)",
                "Derived source z coordinate");
        model.param().set("source_radial_fraction_of_gas_radius", "0.50",
                "TEST_ONLY adjusted from 0.80 because r_source+rL exceeded gas radius");
        model.param().set("source_radius", "source_radial_fraction_of_gas_radius*gas_volume_radius",
                "Derived source radial position");
        model.param().set("source_x", "source_radius", "Source x coordinate");
        model.param().set("source_y", "0[m]", "Source y coordinate");
        model.param().set("initial_total_energy", "100[keV]",
                "CONFIRMED initial total kinetic energy");
        model.param().set("initial_radial_energy", "100[keV]",
                "CONFIRMED initial mostly transverse energy");
        model.param().set("initial_axial_energy", "0[eV]",
                "CONFIRMED single-muon Kz initial");
        model.param().set("initial_tangential_fraction", "0",
                "TEST_ONLY initial tangential velocity fraction of radial speed");
        model.param().set("initial_tangential_speed", "initial_tangential_fraction*initial_radial_speed",
                "TEST_ONLY initial tangential speed; set by initial_tangential_fraction");
        model.param().set("initial_axial_speed", "0[m/s]",
                "TEST_ONLY zero initial axial speed");
        model.param().set("initial_radial_speed", "sqrt(2*initial_radial_energy/m_mu)",
                "Derived radial speed magnitude");
        model.param().set("mu_target_exit_axial_energy", "1[keV]",
                "REFERENCE_TARGET Kz at exit");
        model.param().set("mu_reference_exit_transverse_energy", "10[eV]",
                "REFERENCE_TARGET exploratory transverse energy");

        model.param().set("voltage_V1", "0[V]", "CONFIRMED reference potential");
        model.param().set("voltage_difference_V1_to_V2", "0.5[kV]",
                "TEST_ONLY positive V1-V2 guidance difference");
        model.param().set("voltage_difference_V2_to_V3", "2.0[kV]",
                "TEST_ONLY positive V2-V3 transport difference");
        model.param().set("voltage_difference_V3_to_V4", "-1.5[kV]",
                "TEST_ONLY negative V3-V4 final deceleration difference");
        model.param().set("V1", "voltage_V1", "V1 actual electric potential");
        model.param().set("V2", "V1+voltage_difference_V1_to_V2",
                "V2 actual electric potential");
        model.param().set("V3", "V2+voltage_difference_V2_to_V3",
                "V3 actual electric potential");
        model.param().set("V4", "V3+voltage_difference_V3_to_V4",
                "V4 actual electric potential");

        model.param().set("Ne_number_density", "1e23[1/m^3]",
                "TEST_ONLY baseline chosen from pre-estimate for compact first 3D run");
        model.param().set("Ne_temperature", "300[K]", "CONFIRMED uniform Ne temperature");
        model.param().set("Ne_pressure", "Ne_number_density*k_B_const*Ne_temperature",
                "Derived engineering pressure diagnostic only");
        model.param().set("stopping_energy_min_eV", "10[eV]",
                "Geant4 table lower bound; below it exploratory clamp");
        model.param().set("stopping_energy_max_eV", "1[MeV]",
                "Geant4 table upper bound");
        model.param().set("v_floor", "1[m/s]", "Numerical zero-speed guard only");
        model.param().set("dt_output", "0.5[ns]", "TEST_ONLY output time step");
        model.param().set("t_end", "500[ns]", "TEST_ONLY single-muon horizon");
        model.param().set("ensemble_t_end", "350[ns]", "TEST_ONLY ensemble horizon");
        model.param().set("exit_classification_tolerance", "0.1[mm]",
                "TEST_ONLY exit/loss classification tolerance");
    }

    public static void main(String[] args) throws Exception {
        if (args == null || args.length < 1) {
            throw new IllegalArgumentException("Usage: BuildStage1_3D <stage1-root> [stopping-file]");
        }
        File root = new File(args[0]).getAbsoluteFile();
        File plots = new File(root, "figures");
        File tables = new File(root, "tables");
        File comsol = new File(root, "comsol");
        File logs = new File(root, "logs");
        String stopping = args.length > 1
                ? new File(args[1]).getAbsolutePath()
                : new File(root.getParentFile(), "muon\\ne\\comsol_muNe_SN.txt").getAbsolutePath();

        System.out.println("BUILD_STAGE1_3D_ROOT=" + root.getAbsolutePath());
        System.out.println("BUILD_STAGE1_3D_STOPPING_FILE=" + stopping);
        System.out.println("BUILD_STAGE1_3D_PHASE=CREATE_MODEL");
        Model model = ModelUtil.create("Stage1_3D");
        model.label("stage1_3d_feasibility.mph");
        model.comments("Stage1 3-D feasibility model: mu- transverse cooling plus axial extraction. "
                + "Geant4 mean electromagnetic stopping baseline; no atomic capture or elastic scattering.");
        setParameters(model);
        model.component().create("comp1", true);
        createGeometry(model);
        createMaterials(model);
        createVariables(model);
        createPhysics(model, stopping);
        createStudies(model);

        model.component("comp1").mesh().create("mesh1");
        model.component("comp1").mesh("mesh1").autoMeshSize(3);
        System.out.println("BUILD_STAGE1_3D_PHASE=MESH");
        model.component("comp1").mesh("mesh1").run();

        String mph = path(comsol, "stage1_3d_feasibility.mph");
        model.save(mph);
        System.out.println("CHECKPOINT_CADLIKE_GEOMETRY_AND_MODEL_SAVED=" + mph);
        System.out.println("BUILD_STAGE1_3D_PHASE=SOLVE_ELECTROSTATICS");
        model.study("std_es").run();
        model.save(mph);
        System.out.println("CHECKPOINT_3D_ELECTROSTATICS_SOLVED=" + mph);

        System.out.println("BUILD_STAGE1_3D_PHASE=SOLVE_SINGLE_MUON");
        model.study("std_single").run();
        model.save(mph);
        System.out.println("CHECKPOINT_SINGLE_MUON_SOLVED=" + mph);

        System.out.println("BUILD_STAGE1_3D_PHASE=RESULTS");
        createResults(model, plots, tables);
        model.result().numerical("gev_field").setResult();
        model.result().table("tbl_field").save(path(tables, "baseline_field_diagnostics.csv"));
        model.result().numerical("gev_particle").setResult();
        model.result().table("tbl_particle").save(path(tables, "baseline_particle_timeseries.csv"));

        String[] groups = {"pg_geometry", "pg_field", "pg_potential", "pg_traj",
                           "pg_axis", "pg_energy", "pg_position"};
        for (String group : groups) {
            try { model.result(group).run(); }
            catch (Exception ex) { System.out.println("PLOT_GROUP_FAILED=" + group + " :: " + ex); }
        }
        String[] images = {"img_geometry", "img_field", "img_potential", "img_traj",
                           "img_axis", "img_energy", "img_position"};
        for (String image : images) {
            try { model.result().export(image).run(); }
            catch (Exception ex) { System.out.println("IMAGE_EXPORT_FAILED=" + image + " :: " + ex); }
        }
        try {
            model.component("comp1").geom("geom1").export(path(comsol,
                    "stage1_3d_physics_geometry.step"));
            System.out.println("GEOMETRY_EXPORT_STEP=SUCCESS");
        } catch (Exception ex) {
            System.out.println("GEOMETRY_EXPORT_STEP=FAILED :: " + ex);
        }
        model.save(mph);
        System.out.println("CHECKPOINT_BASELINE_RESULTS_SAVED=" + mph);
        System.out.println("BUILD_STAGE1_3D_COMPLETE");
        System.out.println("OUTPUT_MPH=" + mph);
        System.out.println("PHYSICS_WARNING=Geant4 mean electromagnetic stopping baseline; "
                + "not complete muon-Ne survival prediction.");
    }
}
