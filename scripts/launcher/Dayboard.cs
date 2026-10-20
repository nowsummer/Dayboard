// Dayboard launcher. Compiled by scripts/package.cjs with the .NET Framework
// C# compiler that ships with Windows, so the project folder shows one program
// file with the app icon. It only starts the real app next to it; the path is
// resolved from its own location, so the folder works on any PC or OneDrive path.
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Dayboard")]
[assembly: AssemblyDescription("Dayboard · 할 일, 일정, 메모")]
[assembly: AssemblyProduct("Dayboard")]
[assembly: AssemblyCompany("Dayboard")]
[assembly: AssemblyVersion("__VERSION__.0")]
[assembly: AssemblyFileVersion("__VERSION__.0")]

static class Launcher
{
    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--probe") return 0;
        string here = AppDomain.CurrentDomain.BaseDirectory;
        // A PC that installed Dayboard (Dayboard-x.y.z.exe from GitHub Releases) runs that copy: it is the one
        // that updates itself. Other PCs run the bundle in OneDrive, which an update never replaces.
        string installed = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "dayboard-desktop", "Dayboard.exe");
        string executable = File.Exists(installed) ? installed : Path.Combine(here, "개발 자료", "앱", "Dayboard-win32-x64", "Dayboard.exe");
        if (!File.Exists(executable))
        {
            MessageBox.Show(
                "Dayboard 실행 파일을 찾을 수 없습니다.\n\n" + executable + "\n\n이 파일과 「개발 자료」 폴더를 함께 보관하고, OneDrive 동기화가 끝난 뒤 다시 실행해 주세요.",
                "Dayboard", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
        try
        {
            var start = new ProcessStartInfo(executable)
            {
                WorkingDirectory = Path.GetDirectoryName(executable),
                UseShellExecute = true,
                Arguments = Quote(args)
            };
            Process.Start(start);
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "Dayboard를 시작하지 못했습니다.\n\n" + error.Message + "\n\n「개발 자료\\앱\\Dayboard-win32-x64\\Dayboard.exe」를 직접 실행해 보세요.",
                "Dayboard", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
    }

    static string Quote(string[] args)
    {
        var parts = new string[args.Length];
        for (int i = 0; i < args.Length; i++)
            parts[i] = args[i].IndexOf(' ') >= 0 ? "\"" + args[i].Replace("\"", "\\\"") + "\"" : args[i];
        return string.Join(" ", parts);
    }
}
