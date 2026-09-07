using System;
using System.IO;
using SolidWorks.Interop.sldworks;

/** Export two actual SolidWorks REPORT_3D views without modifying the part. */
public static class ExportStage1SolidWorksPreview
{
    private static void Log(string text)
    {
        Console.WriteLine(text);
        Console.Out.Flush();
    }

    private static void SetBodyVisibility(IPartDoc part, bool shell, bool liner)
    {
        Array bodies = (Array)part.GetBodies2(0, true);
        if (bodies == null) return;
        for (int i = bodies.GetLowerBound(0); i <= bodies.GetUpperBound(0); ++i)
        {
            IBody2 body = (IBody2)bodies.GetValue(i);
            string name = body.Name ?? "";
            if (name.IndexOf("Grounded", StringComparison.OrdinalIgnoreCase) >= 0)
                body.HideBody(!shell);
            else if (name.IndexOf("Dielectric", StringComparison.OrdinalIgnoreCase) >= 0)
                body.HideBody(!liner);
            else
                body.HideBody(false);
        }
    }

    [STAThread]
    public static void Main(string[] args)
    {
        if (args == null || args.Length != 2)
            throw new ArgumentException("Usage: ExportStage1SolidWorksPreview <part> <stage1-root>");
        string partPath = Path.GetFullPath(args[0]);
        string root = Path.GetFullPath(args[1]);
        Directory.CreateDirectory(Path.Combine(root, "figures"));
        var sw = new SldWorksClass();
        sw.Visible = true;
        int errors = 0, warnings = 0;
        IModelDoc2 doc = sw.OpenDoc6(partPath, 1, 1, "", ref errors, ref warnings);
        if (doc == null) throw new Exception("OpenDoc6 returned null");
        doc.ShowConfiguration2("REPORT_3D");
        doc.ShowNamedView2("*Isometric", 7);
        doc.GraphicsRedraw2();
        IPartDoc part = (IPartDoc)doc;

        // Export the complete REPORT_3D view first.  GetBodies2(..., true)
        // returns the currently visible bodies in this interop build, so the
        // order matters when a later cutaway hides the shell and liner.
        SetBodyVisibility(part, true, true);
        doc.ViewZoomtofit2();
        doc.GraphicsRedraw2();
        string external = Path.Combine(root, "figures", "09_solidworks_report_3d_external.bmp");
        Log("EXTERNAL_SAVE=" + doc.SaveBMP(external, 2200, 1500));

        SetBodyVisibility(part, false, false);
        doc.ViewZoomtofit2();
        doc.GraphicsRedraw2();
        string cutaway = Path.Combine(root, "figures", "08_solidworks_report_3d_cutaway.bmp");
        Log("CUTAWAY_SAVE=" + doc.SaveBMP(cutaway, 2200, 1500));
        Log("PREVIEW_COMPLETE");
        try { sw.CloseDoc(doc.GetTitle()); } catch (Exception ex) { Log("CLOSE_NOTE=" + ex.Message); }
        try { sw.ExitApp(); } catch (Exception ex) { Log("EXIT_NOTE=" + ex.Message); }
    }
}
