using System;
using System.Collections.Generic;
using System.IO;
using SolidWorks.Interop.sldworks;

/** Read-only validation of the generated Stage1 master part. */
public static class ValidateStage1SolidWorks
{
    private static void Log(string text)
    {
        Console.WriteLine(text);
        Console.Out.Flush();
    }

    private static void DumpElectrodeApertureEdges(IBody2 body)
    {
        if (body.Name == null || body.Name.IndexOf("V", StringComparison.OrdinalIgnoreCase) < 0)
            return;
        int r15Count = 0;
        int r16Count = 0;
        Array edges = (Array)body.GetEdges();
        if (edges != null)
        {
            for (int i = edges.GetLowerBound(0); i <= edges.GetUpperBound(0); ++i)
            {
                IEdge edge = (IEdge)edges.GetValue(i);
                ICurve curve = (ICurve)edge.GetCurve();
                if (!curve.IsCircle()) continue;
                Array parameters = (Array)curve.CircleParams;
                double radius = (double)parameters.GetValue(6);
                double axial = (double)parameters.GetValue(2);
                if (Math.Abs(radius - 0.015) < 1.0e-9) ++r15Count;
                if (Math.Abs(radius - 0.016) < 1.0e-9) ++r16Count;
                Log("BODY_CIRCLE_EDGE=" + body.Name + " R_MM="
                    + (radius * 1000.0).ToString("G17", System.Globalization.CultureInfo.InvariantCulture)
                    + " AXIAL_RAW_M="
                    + axial.ToString("G17", System.Globalization.CultureInfo.InvariantCulture));
            }
        }
        Log("BODY_APERTURE_ROUNDING=" + body.Name + " R15_COUNT="
            + r15Count + " R16_COUNT=" + r16Count);

        // GetEdges() can omit a circular edge from a late multi-body revolve.
        // Repeat the count through the face edge lists, de-duplicated by
        // radius and axial coordinate, to make the rounding check topology
        // independent.
        int faceR15Count = 0;
        int faceR16Count = 0;
        List<string> seen = new List<string>();
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
                    double axial = (double)parameters.GetValue(2);
                    if (Math.Abs(radius - 0.015) >= 1.0e-9
                        && Math.Abs(radius - 0.016) >= 1.0e-9) continue;
                    string key = radius.ToString("G17", System.Globalization.CultureInfo.InvariantCulture)
                        + ":" + axial.ToString("G17", System.Globalization.CultureInfo.InvariantCulture);
                    if (seen.Contains(key)) continue;
                    seen.Add(key);
                    if (Math.Abs(radius - 0.015) < 1.0e-9) ++faceR15Count;
                    if (Math.Abs(radius - 0.016) < 1.0e-9) ++faceR16Count;
                    Log("BODY_FACE_CIRCLE_EDGE=" + body.Name + " R_MM="
                        + (radius * 1000.0).ToString("G17", System.Globalization.CultureInfo.InvariantCulture)
                        + " AXIAL_RAW_M="
                        + axial.ToString("G17", System.Globalization.CultureInfo.InvariantCulture));
                }
            }
        }
        Log("BODY_FACE_APERTURE_ROUNDING=" + body.Name + " R15_COUNT="
            + faceR15Count + " R16_COUNT=" + faceR16Count);
    }

    [STAThread]
    public static void Main(string[] args)
    {
        if (args == null || args.Length != 1)
            throw new ArgumentException("Usage: ValidateStage1SolidWorks <Stage1_Master_3D.SLDPRT>");
        string partPath = Path.GetFullPath(args[0]);
        var sw = new SldWorksClass();
        sw.Visible = false;
        int errors = 0;
        int warnings = 0;
        IModelDoc2 doc = sw.OpenDoc6(partPath, 1, 1, "", ref errors, ref warnings);
        if (doc == null) throw new Exception("OpenDoc6 returned null");
        Log("OPEN_OK=true");
        Log("OPEN_ERRORS=" + errors);
        Log("OPEN_WARNINGS=" + warnings);
        Log("PATH=" + doc.GetPathName());
        Log("DOC_TYPE=" + doc.GetType());
        Log("FEATURE_COUNT=" + doc.GetFeatureCount());
        Log("CONFIGURATION_COUNT=" + doc.GetConfigurationCount());
        Array configs = (Array)doc.GetConfigurationNames();
        if (configs != null)
        {
            for (int i = configs.GetLowerBound(0); i <= configs.GetUpperBound(0); ++i)
                Log("CONFIG=" + configs.GetValue(i));
        }
        Log("SIM_PRESENT=" + (doc.GetConfigurationByName("SIM_3D") != null));
        Log("REPORT_PRESENT=" + (doc.GetConfigurationByName("REPORT_3D") != null));

        IPartDoc part = (IPartDoc)doc;
        Array bodies = (Array)part.GetBodies2(0, true);
        Log("SOLID_BODY_COUNT=" + (bodies == null ? 0 : bodies.Length));
        if (bodies != null)
        {
            for (int i = bodies.GetLowerBound(0); i <= bodies.GetUpperBound(0); ++i)
            {
                IBody2 body = (IBody2)bodies.GetValue(i);
                Log("BODY=" + body.Name);
                try
                {
                    Array box = (Array)body.GetBodyBox();
                    string values = "";
                    for (int j = box.GetLowerBound(0); j <= box.GetUpperBound(0); ++j)
                        values += (j == box.GetLowerBound(0) ? "" : ",")
                                  + ((double)box.GetValue(j)).ToString("G17", System.Globalization.CultureInfo.InvariantCulture);
                    Log("BODY_BOX=" + body.Name + ":" + values);
                    DumpElectrodeApertureEdges(body);
                }
                catch (Exception ex) { Log("BODY_BOX_NOTE=" + body.Name + ":" + ex.Message); }
            }
        }
        Log("VALIDATION_COMPLETE");
        try { sw.CloseDoc(doc.GetTitle()); } catch (Exception ex) { Log("CLOSE_NOTE=" + ex.Message); }
        try { sw.ExitApp(); } catch (Exception ex) { Log("EXIT_NOTE=" + ex.Message); }
    }
}
