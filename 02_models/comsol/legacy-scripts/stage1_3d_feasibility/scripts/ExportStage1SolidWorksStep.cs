using System;
using System.IO;
using SolidWorks.Interop.sldworks;

/** Export the verified SolidWorks master as a neutral STEP transfer copy. */
public static class ExportStage1SolidWorksStep
{
    [STAThread]
    public static void Main(string[] args)
    {
        if (args == null || args.Length != 2)
            throw new ArgumentException("Usage: ExportStage1SolidWorksStep <part> <output-step>");
        string partPath = Path.GetFullPath(args[0]);
        string stepPath = Path.GetFullPath(args[1]);
        var sw = new SldWorksClass();
        sw.Visible = false;
        int errors = 0, warnings = 0;
        IModelDoc2 doc = sw.OpenDoc6(partPath, 1, 1, "", ref errors, ref warnings);
        if (doc == null) throw new Exception("OpenDoc6 returned null");
        bool ok = doc.Extension.SaveAs(stepPath, 0, 2, null, ref errors, ref warnings);
        Console.WriteLine("STEP_SAVE_OK=" + ok + " ERRORS=" + errors + " WARNINGS=" + warnings);
        Console.WriteLine("STEP_PATH=" + stepPath);
        Console.Out.Flush();
        try { sw.CloseDoc(doc.GetTitle()); } catch (Exception ex) { Console.WriteLine("CLOSE_NOTE=" + ex.Message); }
        try { sw.ExitApp(); } catch (Exception ex) { Console.WriteLine("EXIT_NOTE=" + ex.Message); }
    }
}
