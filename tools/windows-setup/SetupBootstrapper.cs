using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;

namespace Afyx.WindowsSetup
{
    class Program
    {
        static int Main(string[] args)
        {
            Console.WriteLine("====================================================================");
            Console.WriteLine("  Afyx Code Engineering Kit — Unified Windows Setup (7 Components)");
            Console.WriteLine("  Midnight Circuit Architecture | Technical Alpha Candidate");
            Console.WriteLine("====================================================================");

            string currentExePath = Assembly.GetExecutingAssembly().Location;
            string exeDir = Path.GetDirectoryName(currentExePath);

            // Parse setup-level CLI flags
            bool showHelp = false;
            bool extractOnly = false;
            string extractTarget = null;
            bool runVerify = false;
            bool runUninstall = false;
            string forwardArgs = "";

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--help" || a == "-h" || a == "/?")
                {
                    showHelp = true;
                }
                else if (a == "--extract" || a == "-x")
                {
                    extractOnly = true;
                    if (i + 1 < args.Length && !args[i + 1].StartsWith("-"))
                    {
                        extractTarget = args[++i];
                    }
                }
                else if (a == "--verify")
                {
                    runVerify = true;
                }
                else if (a == "--uninstall")
                {
                    runUninstall = true;
                }
                else
                {
                    // Forward remaining arguments to underlying PowerShell script
                    if (a.Contains(" ") && !a.StartsWith("\""))
                    {
                        forwardArgs += " \"" + a + "\"";
                    }
                    else
                    {
                        forwardArgs += " " + a;
                    }
                }
            }

            if (showHelp)
            {
                PrintHelp();
                return 0;
            }

            // Locate payload: either embedded resource or adjacent .afyx-payload.zip
            Stream payloadStream = null;
            var asm = Assembly.GetExecutingAssembly();
            string[] resNames = asm.GetManifestResourceNames();
            foreach (string name in resNames)
            {
                if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) || name.Contains("payload"))
                {
                    payloadStream = asm.GetManifestResourceStream(name);
                    break;
                }
            }

            string adjacentPayload = Path.Combine(exeDir, "afyx-kit-payload.zip");
            if (payloadStream == null && File.Exists(adjacentPayload))
            {
                payloadStream = File.OpenRead(adjacentPayload);
            }

            if (payloadStream == null)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("ERROR: Setup payload package not found inside executable or adjacent directory.");
                Console.ResetColor();
                return 1;
            }

            // Determine extraction folder
            bool isTempExtract = false;
            string stagingDir = extractTarget;
            if (string.IsNullOrEmpty(stagingDir))
            {
                if (extractOnly)
                {
                    stagingDir = Path.Combine(Directory.GetCurrentDirectory(), "afyx-kit");
                }
                else
                {
                    isTempExtract = true;
                    stagingDir = Path.Combine(Path.GetTempPath(), "afyx-setup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
                }
            }

            try
            {
                Console.WriteLine("Extracting setup components to: " + stagingDir);
                Directory.CreateDirectory(stagingDir);

                using (var archive = new ZipArchive(payloadStream, ZipArchiveMode.Read, false))
                {
                    string fullStagingDir = Path.GetFullPath(stagingDir);
                    if (!fullStagingDir.EndsWith(Path.DirectorySeparatorChar.ToString()))
                    {
                        fullStagingDir += Path.DirectorySeparatorChar;
                    }

                    foreach (var entry in archive.Entries)
                    {
                        if (string.IsNullOrEmpty(entry.Name) && (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\")))
                        {
                            continue;
                        }
                        string destPath = Path.Combine(stagingDir, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
                        string fullDestPath = Path.GetFullPath(destPath);
                        if (!fullDestPath.StartsWith(fullStagingDir, StringComparison.OrdinalIgnoreCase))
                        {
                            throw new InvalidOperationException("Security violation: Zip path traversal detected in entry '" + entry.FullName + "'");
                        }
                        string destDir = Path.GetDirectoryName(destPath);
                        if (!Directory.Exists(destDir))
                        {
                            Directory.CreateDirectory(destDir);
                        }
                        entry.ExtractToFile(destPath, true);
                    }
                }

                if (extractOnly)
                {
                    Console.ForegroundColor = ConsoleColor.Green;
                    Console.WriteLine("Payload successfully extracted to: " + stagingDir);
                    Console.ResetColor();
                    return 0;
                }

                // Locate script to run
                string scriptName = "install.ps1";
                if (runVerify) scriptName = "verify.ps1";
                if (runUninstall) scriptName = "uninstall.ps1";

                string targetScript = Path.Combine(stagingDir, scriptName);
                if (!File.Exists(targetScript))
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine("ERROR: Target script not found: " + targetScript);
                    Console.ResetColor();
                    return 1;
                }

                // Determine shell: prefer pwsh.exe, fallback to powershell.exe
                string shellExe = "pwsh.exe";
                if (!IsCommandAvailable("pwsh.exe"))
                {
                    shellExe = "powershell.exe";
                }

                Console.WriteLine("Launching setup using " + shellExe + " -> " + scriptName);
                string psArgs = "-NoProfile -ExecutionPolicy Bypass -File \"" + targetScript + "\"" + forwardArgs;

                var psi = new ProcessStartInfo
                {
                    FileName = shellExe,
                    Arguments = psArgs,
                    UseShellExecute = false,
                    WorkingDirectory = stagingDir
                };

                using (var proc = Process.Start(psi))
                {
                    proc.WaitForExit();
                    return proc.ExitCode;
                }
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("Setup failed: " + ex.Message);
                Console.ResetColor();
                return 1;
            }
            finally
            {
                payloadStream.Dispose();
                if (isTempExtract && Directory.Exists(stagingDir))
                {
                    try
                    {
                        Directory.Delete(stagingDir, true);
                    }
                    catch { }
                }
            }
        }

        static bool IsCommandAvailable(string cmd)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "where.exe",
                    Arguments = cmd,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                using (var p = Process.Start(psi))
                {
                    p.WaitForExit();
                    return p.ExitCode == 0;
                }
            }
            catch { return false; }
        }

        static void PrintHelp()
        {
            Console.WriteLine("Usage: AfyxSetup.exe [options] [-- <PowerShell arguments>]");
            Console.WriteLine();
            Console.WriteLine("Options:");
            Console.WriteLine("  --help, -h               Show this help message and exit.");
            Console.WriteLine("  --extract, -x [dir]      Extract the full kit payload without running installation.");
            Console.WriteLine("  --verify                 Execute verification against installed components.");
            Console.WriteLine("  --uninstall              Execute uninstallation workflow.");
            Console.WriteLine("  -Preset <preset>         Specify preset: minimal, recommended, full, or custom.");
            Console.WriteLine("  -CustomComponent <list>  Specify components: efficient-coding, odoo-engineering,");
            Console.WriteLine("                           afyx-engineering-expert, afyx-graph, afyx-context,");
            Console.WriteLine("                           afyx-forge, codex-usage-tracking.");
            Console.WriteLine("  -ValidateOnly            Run read-only pre-flight checks without making changes.");
            Console.WriteLine("  -WhatIf                  Preview actions without making changes.");
            Console.WriteLine("  -Provider <providers>    Configure providers (codex, antigravity, claude).");
            Console.WriteLine();
            Console.WriteLine("When executed with no arguments, interactive setup wizard will launch.");
        }
    }
}
