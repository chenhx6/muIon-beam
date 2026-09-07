using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using SolidWorks.Interop.sldworks;

/**
 * Build the editable SolidWorks Stage1 master part through the official
 * SolidWorks 2025 COM interop API.
 *
 * The physical bodies are created from one parameter-readable radial/axial
 * profile and revolved about the z axis.  This gives a compact multi-body
 * part: grounded shell, dielectric liner, and four finite-thickness annular
 * electrodes.  SIM_3D and REPORT_3D configurations are added to the same
 * SLDPRT.  The geometry is an engineering feasibility master, not a final
 * manufacturing drawing.
 */
public static class BuildStage1SolidWorks
{
    private const double Mm = 1.0e-3;
    private const double ApertureFilletRadiusM = 1.0e-3;

    private static void Log(string message)
    {
        Console.Error.WriteLine(message);
        Console.Error.Flush();
    }

    private static string ExceptionSummary(Exception ex)
    {
        try
        {
            return ex.GetType().FullName + " HResult=0x"
                + ex.HResult.ToString("X8") + " Message=" + ex.Message;
        }
        catch
        {
            return "exception details unavailable";
        }
    }

    private static void AddRectangle(ISketchManager sketch, double r0, double z0,
                                     double r1, double z1)
    {
        // On the SolidWorks Top Plane the sketch-y direction maps to -CAD-z.
        // Reverse it so the saved master follows the project convention +z=exit.
        double y0 = -z0 * Mm;
        double y1 = -z1 * Mm;
        sketch.CreateLine(r0 * Mm, y0, 0, r1 * Mm, y0, 0);
        sketch.CreateLine(r1 * Mm, y0, 0, r1 * Mm, y1, 0);
        sketch.CreateLine(r1 * Mm, y1, 0, r0 * Mm, y1, 0);
        sketch.CreateLine(r0 * Mm, y1, 0, r0 * Mm, y0, 0);
    }

    private static void AddRoundedAnnularProfile(IModelDoc2 doc, ISketchManager sketch,
                                                 double r0, double z0, double r1, double z1,
                                                 bool innerFirst)
    {
        double y0 = -z0 * Mm;
        double y1 = -z1 * Mm;
        ISketchSegment bottom = sketch.CreateLine(r0 * Mm, y0, 0, r1 * Mm, y0, 0);
        ISketchSegment right = sketch.CreateLine(r1 * Mm, y0, 0, r1 * Mm, y1, 0);
        ISketchSegment inner;
        ISketchSegment top;
        if (innerFirst)
        {
            // For V2–V4, creating the inner segment first avoids a transient
            // endpoint-merge failure observed at the fourth body.
            inner = sketch.CreateLine(r0 * Mm, y0, 0, r0 * Mm, y1, 0);
            top = sketch.CreateLine(r1 * Mm, y1, 0, r0 * Mm, y1, 0);
        }
        else
        {
            // The first body is more stable with the conventional top-then-
            // inner ordering and retains both rounded end edges.
            top = sketch.CreateLine(r1 * Mm, y1, 0, r0 * Mm, y1, 0);
            inner = sketch.CreateLine(r0 * Mm, y1, 0, r0 * Mm, y0, 0);
        }
        if (bottom == null) throw new Exception("annular profile bottom edge creation failed");
        if (right == null) throw new Exception("annular profile outer edge creation failed");
        if (top == null) throw new Exception("annular profile top edge creation failed");
        if (inner == null) throw new Exception("annular profile inner edge creation failed");

        // Native sketch fillets produce the actual rounded aperture profile
        // before revolve.  This is more stable in a multi-body part than
        // post-revolve edge enumeration, especially for V4.
        doc.ClearSelection2(true);
        if (!inner.Select2(false, 0) || !bottom.Select2(true, 0))
            throw new Exception("bottom aperture corner selection failed");
        try
        {
            doc.SketchFillet(ApertureFilletRadiusM);
        }
        catch (Exception ex)
        {
            Log("SKETCH_FILLET_BOTTOM_ERROR=" + ExceptionSummary(ex));
            throw;
        }
        doc.ClearSelection2(true);
        if (!inner.Select2(false, 0) || !top.Select2(true, 0))
            throw new Exception("top aperture corner selection failed");
        try
        {
            doc.SketchFillet(ApertureFilletRadiusM);
        }
        catch (Exception ex)
        {
            Log("SKETCH_FILLET_TOP_ERROR=" + ExceptionSummary(ex));
            throw;
        }
        doc.ClearSelection2(true);
    }

    private static void AddCustomProperty(IModelDoc2 doc, string name, string value)
    {
        try
        {
            // 30 is the SolidWorks text custom-property type in the COM API.
            doc.AddCustomInfo3("", name, 30, value);
        }
        catch (Exception ex)
        {
            Log("CUSTOM_PROPERTY_SKIPPED=" + name + " :: " + ex.Message);
        }
    }

    private static string BodySummary(IPartDoc part)
    {
        try
        {
            Array bodies = (Array)part.GetBodies2(0, true);
            return "SOLID_BODY_COUNT=" + (bodies == null ? 0 : bodies.Length);
        }
        catch (Exception ex)
        {
            return "SOLID_BODY_COUNT_UNKNOWN=" + ex.Message;
        }
    }

    private static IModelDoc2 ReopenCheckpoint(SldWorksClass sw, IModelDoc2 doc,
                                               string checkpointPath)
    {
        if (!doc.SaveAs(checkpointPath))
            throw new Exception("checkpoint SaveAs returned false");
        Log("CHECKPOINT_SAVE=" + checkpointPath);
        string title = doc.GetTitle();
        sw.CloseDoc(title);
        int errors = 0;
        int warnings = 0;
        IModelDoc2 reopened = sw.OpenDoc6(checkpointPath, 1, 1, "",
                                          ref errors, ref warnings);
        Log("CHECKPOINT_REOPEN_ERRORS=" + errors);
        Log("CHECKPOINT_REOPEN_WARNINGS=" + warnings);
        if (reopened == null)
            throw new Exception("checkpoint OpenDoc6 returned null");
        Log("CHECKPOINT_REOPEN=SUCCESS");
        return reopened;
    }

    private static IModelDoc2 CreateMasterGeometry(SldWorksClass sw,
                                                    IModelDoc2 doc,
                                                    string checkpointPath)
    {
        IFeatureManager fm = (IFeatureManager)doc.FeatureManager;
        // Create V1–V3, save, and reopen before V4.  SolidWorks 2025 can
        // return a null fourth inner sketch segment after several native
        // sketch-fillet/revolve cycles in one live document; a checkpoint
        // reopen resets that transient multi-body sketch state without
        // changing the physical geometry.
        CreateRevolvedBody(doc, fm, "V1", 15.0, 25.0, 40.0, 28.0,
                           "V1_Annular_Electrode_D30_t3");
        CreateRevolvedBody(doc, fm, "V2", 15.0, 158.0, 40.0, 161.0,
                           "V2_Annular_Electrode_D30_t3");
        CreateRevolvedBody(doc, fm, "V3", 15.0, 381.0, 40.0, 384.0,
                           "V3_Annular_Electrode_D30_t3");
        doc = ReopenCheckpoint(sw, doc, checkpointPath);
        fm = (IFeatureManager)doc.FeatureManager;
        CreateRevolvedBody(doc, fm, "V4", 15.0, 544.0, 40.0, 547.0,
                           "V4_Annular_Electrode_D30_t3");
        CreateRevolvedBody(doc, fm, "GroundedShell", 50.0, 0.0, 55.0, 597.0,
                           "Grounded_Safety_Shell_100mm_Bore");
        CreateRevolvedBody(doc, fm, "DielectricLiner", 45.0, 0.0, 50.0, 597.0,
                           "Dielectric_Liner_Representative_Alumina");
        IPartDoc part = (IPartDoc)doc;
        Log(BodySummary(part));
        return doc;
    }

    private static void CreateRevolvedBody(IModelDoc2 doc, IFeatureManager fm,
                                           string id, double r0, double z0,
                                           double r1, double z1, string featureName)
    {
        Log("BEGIN_BODY=" + id);
        try
        {
            doc.ClearSelection2(true);
            if (!doc.Extension.SelectByID2("Top Plane", "PLANE", 0, 0, 0, false, 0, null, 0))
                throw new Exception("Top Plane selection failed for " + id);
            Log("PLANE_SELECTED=" + id);
            ISketchManager sketch = (ISketchManager)doc.SketchManager;
            sketch.InsertSketch(true);
            Log("SKETCH_STARTED=" + id);
            ISketchSegment axis = sketch.CreateCenterLine(0, 0, 0, 0, 0.65, 0);
            if (axis == null) throw new Exception("revolve axis creation failed for " + id);
            Log("AXIS_CREATED=" + id);
            if (id.StartsWith("V", StringComparison.OrdinalIgnoreCase))
                AddRoundedAnnularProfile(doc, sketch, r0, z0, r1, z1,
                    !id.Equals("V1", StringComparison.OrdinalIgnoreCase));
            else
                AddRectangle(sketch, r0, z0, r1, z1);
            Log("PROFILE_CREATED=" + id);
            sketch.InsertSketch(true);
            Log("SKETCH_FINISHED=" + id);
            doc.ClearSelection2(true);
            if (!axis.Select(false)) throw new Exception("axis selection failed for " + id);
            Log("AXIS_SELECTED=" + id);
            Feature feature = fm.FeatureRevolve(2.0 * Math.PI, false, 0.0,
                                                 0, 0, false, false, false);
            if (feature == null) throw new Exception("FeatureRevolve returned null for " + id);
            feature.Name = featureName;
            Log("REVOLVED_BODY=" + id + " SUCCESS");
            doc.ForceRebuild3(false);
            Log("REBUILD_COMPLETE=" + id);
            // The V1–V4 aperture rounding is part of the sketch profile and
            // is therefore carried by the revolve itself.  No post-revolve
            // edge enumeration is needed.
        }
        catch (Exception ex)
        {
            Log("BODY_ERROR=" + id + " :: " + ExceptionSummary(ex));
            throw;
        }
    }

    private static void ApplyApertureFillet(IModelDoc2 doc, IFeatureManager fm,
                                             Feature revolve, string id,
                                             double z0, double z1)
    {
        IBody2 body = null;
        Array allBodies = (Array)((IPartDoc)doc).GetBodies2(0, true);
        Log("FILLET_BODY_CANDIDATE_COUNT=" + (allBodies == null ? 0 : allBodies.Length)
            + " TARGET=" + id + " Z0=" + z0 + " Z1=" + z1);
        if (allBodies != null)
        {
            // In a multi-body document IGetBody2 can resolve to the previous
            // feature. Select the body by its measured axial bounding box.
            for (int index = allBodies.GetLowerBound(0); index <= allBodies.GetUpperBound(0); ++index)
            {
                IBody2 candidate = (IBody2)allBodies.GetValue(index);
                try
                {
                    Array box = (Array)candidate.GetBodyBox();
                    double zMin = (double)box.GetValue(2);
                    double zMax = (double)box.GetValue(5);
                    double xMax = Math.Abs((double)box.GetValue(3));
                    Log("FILLET_BODY_BOX=" + candidate.Name + " :: z=" + zMin + "-" + zMax + " xMax=" + xMax);
                    if (Math.Abs(zMin - z0 * Mm) < 1.0e-8
                        && Math.Abs(zMax - z1 * Mm) < 1.0e-8
                        && Math.Abs(xMax - 0.040) < 1.0e-8)
                    {
                        body = candidate;
                        break;
                    }
                }
                catch (Exception) { }
            }
        }
        if (body == null) body = revolve.IGetBody2();
        Log("FILLET_BODY_SELECTED=" + (body == null ? "NULL" : body.Name));
        if (body == null) throw new Exception("cannot obtain body for aperture fillet " + id);
        List<object> apertureEdges = new List<object>();
        List<double> axialCenters = new List<double>();
        // Body2.GetEdges() can omit a shared circular edge in a multi-body
        // feature tree. Walk face edge lists as well and de-duplicate by the
        // axial center coordinate from CircleParams.
        Array faces = (Array)body.GetFaces();
        if (faces != null)
        {
            for (int faceIndex = faces.GetLowerBound(0); faceIndex <= faces.GetUpperBound(0); ++faceIndex)
            {
                IFace2 face = (IFace2)faces.GetValue(faceIndex);
                Array faceEdges = (Array)face.GetEdges();
                if (faceEdges == null) continue;
                for (int edgeIndex = faceEdges.GetLowerBound(0); edgeIndex <= faceEdges.GetUpperBound(0); ++edgeIndex)
                {
                    IEdge edge = (IEdge)faceEdges.GetValue(edgeIndex);
                    ICurve curve = (ICurve)edge.GetCurve();
                    if (!curve.IsCircle()) continue;
                    Array parameters = (Array)curve.CircleParams;
                    double radius = (double)parameters.GetValue(6);
                    double axialCenter = (double)parameters.GetValue(2);
                    if (Math.Abs(radius - 0.015) < 1.0e-9)
                    {
                        bool alreadySeen = false;
                        foreach (double existing in axialCenters)
                            if (Math.Abs(existing - axialCenter) < 1.0e-9) alreadySeen = true;
                        if (!alreadySeen)
                        {
                            axialCenters.Add(axialCenter);
                            apertureEdges.Add(edge);
                        }
                    }
                }
            }
        }
        if (apertureEdges.Count < 2)
        {
            // A late multi-body revolve can expose a reduced face topology on
            // the body-list proxy but a complete edge set through the feature
            // proxy. Merge any missing radius-15 mm circular edges from it.
            IBody2 featureBody = revolve.IGetBody2();
            if (featureBody != null)
            {
                Array featureEdges = (Array)featureBody.GetEdges();
                if (featureEdges != null)
                {
                    for (int edgeIndex = featureEdges.GetLowerBound(0); edgeIndex <= featureEdges.GetUpperBound(0); ++edgeIndex)
                    {
                        IEdge edge = (IEdge)featureEdges.GetValue(edgeIndex);
                        ICurve curve = (ICurve)edge.GetCurve();
                        if (!curve.IsCircle()) continue;
                        Array parameters = (Array)curve.CircleParams;
                        double radius = (double)parameters.GetValue(6);
                        double axialCenter = (double)parameters.GetValue(2);
                        if (Math.Abs(radius - 0.015) >= 1.0e-9) continue;
                        bool alreadySeen = false;
                        foreach (double existing in axialCenters)
                            if (Math.Abs(existing - axialCenter) < 1.0e-9) alreadySeen = true;
                        if (!alreadySeen)
                        {
                            axialCenters.Add(axialCenter);
                            apertureEdges.Add(edge);
                        }
                    }
                }
                Log("FILLET_FEATURE_PROXY=" + featureBody.Name + " EDGE_COUNT="
                    + (featureEdges == null ? 0 : featureEdges.Length));
            }
        }
        if (apertureEdges.Count < 1)
            throw new Exception("no aperture edge found for " + id);
        if (apertureEdges.Count != 2)
            Log("APERTURE_FILLET_EDGE_COUNT_NOTE=" + id + " found=" + apertureEdges.Count
                + "; applying fillet to all returned aperture edges");
        foreach (object edge in apertureEdges)
            ((IEntity)edge).Select2(true, 0);
        object fillet = fm.FeatureFillet(apertureEdges.Count, 0.001, 0, 0,
                                          apertureEdges.ToArray(), null, null);
        if (fillet == null) throw new Exception("FeatureFillet returned null for " + id);
        Feature filletFeature = fillet as Feature;
        if (filletFeature != null) filletFeature.Name = id + "_Aperture_Fillet_R1mm";
        Log("APERTURE_FILLET=" + id + " R=1mm SUCCESS");
    }

    private static void AddConfigurations(IModelDoc2 doc)
    {
        try
        {
            bool sim = doc.AddConfiguration2("SIM_3D",
                "Physics geometry: shell, dielectric liner, Ne void, four annular electrodes",
                "", false, false, false, false, 0);
            Log("CONFIG_SIM_3D=" + sim);
        }
        catch (Exception ex) { Log("CONFIG_SIM_3D_ERROR=" + ex.Message); }
        try
        {
            bool report = doc.AddConfiguration2("REPORT_3D",
                "Presentation geometry: readable Stage1 device layout and direction annotations",
                "", false, false, true, false, 0);
            Log("CONFIG_REPORT_3D=" + report);
        }
        catch (Exception ex) { Log("CONFIG_REPORT_3D_ERROR=" + ex.Message); }
        try { doc.ShowConfiguration2("REPORT_3D"); }
        catch (Exception ex) { Log("SHOW_REPORT_3D_ERROR=" + ex.Message); }
    }

    private static void AddDirectionSketch(IModelDoc2 doc)
    {
        // A lightweight, non-physics sketch gives REPORT_3D a persistent
        // visual +z and radial-injection cue without changing the bodies.
        try
        {
            if (!doc.Extension.SelectByID2("Top Plane", "PLANE", 0, 0, 0, false, 0, null, 0))
                throw new Exception("Top Plane selection failed for report sketch");
            ISketchManager sketch = (ISketchManager)doc.SketchManager;
            sketch.InsertSketch(true);
            ISketchSegment z0 = sketch.CreateCenterLine(-45 * Mm, -480 * Mm, 0,
                                                        -45 * Mm, -560 * Mm, 0);
            ISketchSegment z1 = sketch.CreateLine(-45 * Mm, -560 * Mm, 0,
                                                  -48 * Mm, -550 * Mm, 0);
            ISketchSegment z2 = sketch.CreateLine(-45 * Mm, -560 * Mm, 0,
                                                  -42 * Mm, -550 * Mm, 0);
            ISketchSegment r0 = sketch.CreateCenterLine(24 * Mm, -92 * Mm, 0,
                                                        4 * Mm, -92 * Mm, 0);
            ISketchSegment r1 = sketch.CreateLine(4 * Mm, -92 * Mm, 0,
                                                  9 * Mm, -89 * Mm, 0);
            ISketchSegment r2 = sketch.CreateLine(4 * Mm, -92 * Mm, 0,
                                                  9 * Mm, -95 * Mm, 0);
            sketch.InsertSketch(true);
            Feature feature = (Feature)doc.FeatureByPositionReverse(0);
            if (feature != null) feature.Name = "REPORT_3D_Direction_Arrows";
            Log("REPORT_DIRECTION_SKETCH=SUCCESS");
        }
        catch (Exception ex) { Log("REPORT_DIRECTION_SKETCH=SKIPPED :: " + ex.Message); }
    }

    [STAThread]
    public static void Main(string[] args)
    {
        string root = args != null && args.Length > 0 ? args[0] : ".";
        root = Path.GetFullPath(root);
        string cad = Path.Combine(root, "cad");
        Directory.CreateDirectory(cad);
        string output = Path.Combine(cad, "Stage1_Master_3D.SLDPRT");

        Log("SOLIDWORKS_MASTER_ROOT=" + root);
        Log("SOLIDWORKS_MASTER_OUTPUT=" + output);
        SldWorksClass sw = new SldWorksClass();
        sw.Visible = true;
        sw.UserControl = false;
        Log("SOLIDWORKS_APP=CREATED");
        string template = @"C:\ProgramData\SOLIDWORKS\SOLIDWORKS 2025\templates\MBD\part 0051mm to 0250mm.prtdot";
        IModelDoc2 doc = sw.INewDocument2(template, 0, 0.0, 0.0);
        if (doc == null) throw new Exception("INewDocument2 returned null");
        Log("PART_DOCUMENT=CREATED");

        string checkpointPath = Path.Combine(root, "intermediate",
            "solidworks_native_fillet_v1_v3_checkpoint.SLDPRT");
        Directory.CreateDirectory(Path.GetDirectoryName(checkpointPath));
        doc = CreateMasterGeometry(sw, doc, checkpointPath);
        AddCustomProperty(doc, "ModelName", "Stage1_Master_3D");
        AddCustomProperty(doc, "PhysicsConfiguration", "SIM_3D");
        AddCustomProperty(doc, "ReportConfiguration", "REPORT_3D");
        AddCustomProperty(doc, "BoreInnerDiameter", "100 mm");
        AddCustomProperty(doc, "ElectrodeApertureDiameter", "30 mm");
        AddCustomProperty(doc, "ElectrodeThickness", "3 mm TEST_ONLY baseline");
        AddCustomProperty(doc, "ApertureEdgeRoundRadius", "1 mm TEST_ONLY baseline");
        AddCustomProperty(doc, "Dielectric", "Representative alumina ceramic; epsilon_r=9.4 assumption");
        AddCustomProperty(doc, "ElectrodeOuterDiameter", "80 mm TEST_ONLY baseline");
        AddCustomProperty(doc, "V1V2ClearSpacing", "130 mm PRE_SCAN_DERIVED");
        AddCustomProperty(doc, "V2V3ClearSpacing", "220 mm PRE_SCAN_DERIVED");
        AddCustomProperty(doc, "V3V4ClearSpacing", "160 mm PRE_SCAN_DERIVED");
        AddCustomProperty(doc, "Stage1TotalLength", "597 mm DERIVED Lstage1");
        AddCustomProperty(doc, "SourceAxialFraction", "0.5 between V1 and V2");
        AddCustomProperty(doc, "SourceRadialFraction", "0.50 of Ne gas radius TEST_ONLY");
        AddCustomProperty(doc, "BaselineVoltages", "V1=0 V; V2=0.5 kV; V3=2.5 kV; V4=1.0 kV");
        AddCustomProperty(doc, "CoordinateConvention", "+z is extraction direction; radial source points inward");
        AddConfigurations(doc);
        AddDirectionSketch(doc);
        doc.ShowConfiguration2("SIM_3D");
        if (!doc.SaveAs(output)) throw new Exception("SLDPRT SaveAs returned false");
        Log("SLDPRT_SAVE=SUCCESS");

        // Restore report configuration for the next human visual inspection.
        try { doc.ShowConfiguration2("REPORT_3D"); doc.Save(); } catch (Exception ex) { Log("REPORT_RESTORE_ERROR=" + ex.Message); }
        Log("CONFIGURATIONS=" + doc.GetConfigurationCount());
        Log("MASTER_COMPLETE");
        // CloseDoc is the supported COM close path; ModelDoc2.Close is not
        // implemented by this SolidWorks 2025 interop build.
        try { sw.CloseDoc(doc.GetTitle()); } catch (Exception ex) { Log("CLOSE_DOC_NOTE=" + ex.Message); }
        try { sw.ExitApp(); } catch (Exception ex) { Log("EXIT_APP_NOTE=" + ex.Message); }
    }
}
