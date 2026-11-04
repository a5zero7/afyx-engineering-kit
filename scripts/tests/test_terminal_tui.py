from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "scripts" / "lib" / "AfyxTerminal.psm1"


def powershell() -> str | None:
    return shutil.which("pwsh") or shutil.which("powershell")


class TerminalPresentationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.shell = powershell()
        if not cls.shell:
            raise unittest.SkipTest("PowerShell is unavailable")

    def run_ps(self, script: str, *, env: dict[str, str] | None = None, expected: int = 0) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [self.shell, "-NoProfile", "-NonInteractive", "-Command", script],
            cwd=ROOT,
            env=env,
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def test_module_import_is_quiet_and_exports_only_approved_public_verbs(self) -> None:
        result = self.run_ps(
            f"Import-Module '{MODULE}' -Force; "
            "(Get-Command -Module AfyxTerminal | Select-Object -ExpandProperty Name) -join ','"
        )
        self.assertNotIn("unapproved verbs", result.stderr.lower())
        self.assertIn("Read-AfyxSingleChoice", result.stdout)
        self.assertIn("Show-AfyxReceipt", result.stdout)

    @unittest.skipUnless(os.name == "nt", "Windows PowerShell 5.1 is Windows-only")
    def test_module_imports_in_windows_powershell_51(self) -> None:
        windows_powershell = shutil.which("powershell.exe")
        if not windows_powershell:
            self.skipTest("Windows PowerShell 5.1 unavailable")
        result = subprocess.run(
            [
                windows_powershell,
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                f"$ErrorActionPreference='Stop'; Import-Module '{MODULE}' -Force; 'IMPORTED'",
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), "IMPORTED")

    def test_plain_and_ansi_modes_preserve_identical_facts(self) -> None:
        script = f"""
Import-Module '{MODULE}' -Force
$plain = [pscustomobject]@{{ Ansi = $false; Interactive = $false; Width = 80 }}
$ansi = [pscustomobject]@{{ Ansi = $true; Interactive = $true; Width = 80 }}
$expected = '[HEALTHY] Afyx Graph — version=1.0.0'
$colored = (Get-AfyxStyledText -Text '[HEALTHY]' -Tone Success -Terminal $ansi) + ' Afyx Graph — version=1.0.0'
$stripped = $colored -replace "$([char]27)\\[[0-9;]*m", ''
[pscustomobject]@{{ Expected = $expected; Stripped = $stripped; Plain = (Get-AfyxStyledText -Text $expected -Terminal $plain) }} | ConvertTo-Json -Compress
"""
        result = self.run_ps(script)
        self.assertIn('"Expected":"[HEALTHY] Afyx Graph', result.stdout)
        self.assertIn('"Stripped":"[HEALTHY] Afyx Graph', result.stdout)
        self.assertIn('"Plain":"[HEALTHY] Afyx Graph', result.stdout)

    def test_no_color_disables_ansi(self) -> None:
        env = os.environ.copy()
        env["NO_COLOR"] = "1"
        result = self.run_ps(f"Import-Module '{MODULE}' -Force; Test-AfyxAnsiSupport", env=env)
        self.assertEqual(result.stdout.strip(), "False")

    def test_narrow_width_wrap_is_bounded(self) -> None:
        result = self.run_ps(
            f"Import-Module '{MODULE}' -Force; "
            "$lines=@(Format-AfyxWrappedText -Text ('alpha beta gamma delta epsilon zeta eta theta') -Width 18 -Indent '  '); "
            "if(@($lines|Where-Object{$_.Length -gt 18}).Count){throw 'overflow'}; $lines.Count"
        )
        self.assertGreater(int(result.stdout.strip()), 1)

    def test_arrow_navigation_selects_next_enabled_option(self) -> None:
        script = f"""
Import-Module '{MODULE}' -Force
$terminal=[pscustomobject]@{{Ansi=$false;Interactive=$true;Width=80}}
$options=@(
 [pscustomobject]@{{Id='first';Label='First';Enabled=$true}},
 [pscustomobject]@{{Id='disabled';Label='Disabled';Enabled=$false}},
 [pscustomobject]@{{Id='third';Label='Third';Enabled=$true}}
)
$keys=[Collections.Queue]::new()
$keys.Enqueue([ConsoleKeyInfo]::new([char]0,[ConsoleKey]::DownArrow,$false,$false,$false))
$keys.Enqueue([ConsoleKeyInfo]::new([char]13,[ConsoleKey]::Enter,$false,$false,$false))
Read-AfyxSingleChoice -Prompt test -Options $options -DefaultId first -Terminal $terminal -ReadKey {{$keys.Dequeue()}} -NoRender
"""
        result = self.run_ps(script)
        self.assertEqual(result.stdout.strip(), "third")

    def test_advanced_menu_redraws_in_place(self) -> None:
        script = f"""
Import-Module '{MODULE}' -Force
$terminal=[pscustomobject]@{{Ansi=$true;Interactive=$true;Width=80}}
$options=@([pscustomobject]@{{Id='a';Label='A'}},[pscustomobject]@{{Id='b';Label='B'}})
$keys=[Collections.Queue]::new()
$keys.Enqueue([ConsoleKeyInfo]::new([char]0,[ConsoleKey]::DownArrow,$false,$false,$false))
$keys.Enqueue([ConsoleKeyInfo]::new([char]13,[ConsoleKey]::Enter,$false,$false,$false))
Read-AfyxSingleChoice -Prompt redraw -Options $options -Terminal $terminal -ReadKey {{$keys.Dequeue()}}
"""
        result = self.run_ps(script)
        self.assertEqual(result.stdout.count("\x1b[4A"), 1)
        self.assertEqual(result.stdout.count("\x1b[0J"), 1)
        self.assertTrue(result.stdout.rstrip().endswith("b"), result.stdout)

    def test_space_toggles_multiple_components(self) -> None:
        script = f"""
Import-Module '{MODULE}' -Force
$terminal=[pscustomobject]@{{Ansi=$false;Interactive=$true;Width=80}}
$options=@([pscustomobject]@{{Id='a';Label='A'}},[pscustomobject]@{{Id='b';Label='B'}})
$keys=[Collections.Queue]::new()
$keys.Enqueue([ConsoleKeyInfo]::new(' ',[ConsoleKey]::Spacebar,$false,$false,$false))
$keys.Enqueue([ConsoleKeyInfo]::new([char]0,[ConsoleKey]::DownArrow,$false,$false,$false))
$keys.Enqueue([ConsoleKeyInfo]::new(' ',[ConsoleKey]::Spacebar,$false,$false,$false))
$keys.Enqueue([ConsoleKeyInfo]::new([char]13,[ConsoleKey]::Enter,$false,$false,$false))
@(Read-AfyxMultiChoice -Prompt test -Options $options -Terminal $terminal -ReadKey {{$keys.Dequeue()}} -NoRender) -join ','
"""
        result = self.run_ps(script)
        self.assertEqual(result.stdout.strip(), "a,b")

    def test_escape_cancels_before_mutation(self) -> None:
        script = f"""
Import-Module '{MODULE}' -Force
$terminal=[pscustomobject]@{{Ansi=$false;Interactive=$true;Width=80}}
$options=@([pscustomobject]@{{Id='a';Label='A'}})
try {{
 Read-AfyxSingleChoice -Prompt test -Options $options -Terminal $terminal -ReadKey {{[ConsoleKeyInfo]::new([char]27,[ConsoleKey]::Escape,$false,$false,$false)}} -NoRender
 throw 'not cancelled'
}} catch [OperationCanceledException] {{ 'CANCELLED' }}
"""
        result = self.run_ps(script)
        self.assertEqual(result.stdout.strip(), "CANCELLED")

    def test_negative_confirmation_cannot_cross_mutation_boundary(self) -> None:
        script = f"""
Import-Module '{MODULE}' -Force
$terminal=[pscustomobject]@{{Ansi=$false;Interactive=$true;Width=80}}
$mutated=$false
if (Read-AfyxConfirmation -Prompt test -Terminal $terminal -ReadKey {{[ConsoleKeyInfo]::new([char]13,[ConsoleKey]::Enter,$false,$false,$false)}} -NoRender) {{ $mutated=$true }}
if ($mutated) {{ throw 'mutation crossed cancelled confirmation' }}
'CANCELLED_NO_MUTATION'
"""
        result = self.run_ps(script)
        self.assertEqual(result.stdout.strip(), "CANCELLED_NO_MUTATION")

    def test_numbered_fallback_works_without_advanced_terminal(self) -> None:
        script = f"""
Import-Module '{MODULE}' -Force
$terminal=[pscustomobject]@{{Ansi=$false;Interactive=$true;Width=60}}
$options=@([pscustomobject]@{{Id='a';Label='A'}},[pscustomobject]@{{Id='b';Label='B'}})
Read-AfyxSingleChoice -Prompt test -Options $options -Terminal $terminal -ReadLine {{'2'}} -NoRender
"""
        result = self.run_ps(script)
        self.assertEqual(result.stdout.strip(), "b")

    def test_outcome_status_distinguishes_healthy_skip_from_uninstalled_skip(self) -> None:
        result = self.run_ps(
            f"Import-Module '{MODULE}' -Force; "
            "@((Get-AfyxOutcomeStatus -ComponentState HEALTHY -Action skipped),"
            "(Get-AfyxOutcomeStatus -ComponentState 'NOT INSTALLED' -Action skipped),"
            "(Get-AfyxOutcomeStatus -ComponentState HEALTHY -Action update -WhatIf)) -join '|'"
        )
        self.assertEqual(result.stdout.strip(), "NO CHANGE|SKIPPED|PLANNED")

    def test_powershell_sources_parse(self) -> None:
        for source in (ROOT / "install.ps1", ROOT / "verify.ps1", MODULE):
            script = (
                "$errors=$null; [Management.Automation.Language.Parser]::ParseFile("
                f"'{source}',[ref]$null,[ref]$errors)|Out-Null; "
                "if($errors.Count){$errors|ForEach-Object{$_.Message};exit 1}"
            )
            self.run_ps(script)

    def test_validate_only_and_whatif_are_plain_noninteractive_and_immutable(self) -> None:
        with tempfile.TemporaryDirectory(prefix="afyx-tui-readonly-") as raw:
            root = Path(raw)
            env = os.environ.copy()
            env.update(
                {
                    "USERPROFILE": str(root / "profile"),
                    "HOME": str(root / "profile"),
                    "APPDATA": str(root / "appdata"),
                    "CODEX_HOME": str(root / "codex"),
                    "AFYX_GRAPH_RUNTIME_ROOT": str(root / "graph"),
                    "AFYX_CONTEXT_RUNTIME_ROOT": str(root / "context"),
                    "NO_COLOR": "1",
                }
            )
            git = shutil.which("git")
            self.assertIsNotNone(git)
            env["PATH"] = str(Path(git).parent)
            validate = subprocess.run(
                [self.shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "install.ps1"),
                 "-ValidateOnly", "-Preset", "custom", "-Provider", "codex", "-SkipProviderConfiguration"],
                cwd=ROOT, env=env, text=True, capture_output=True, timeout=90,
            )
            self.assertEqual(validate.returncode, 0, validate.stdout + validate.stderr)
            self.assertNotIn("\x1b[", validate.stdout + validate.stderr)
            self.assertNotIn("Selection", validate.stdout + validate.stderr)

            whatif = subprocess.run(
                [self.shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "install.ps1"),
                 "-WhatIf", "-Preset", "minimal", "-Provider", "codex", "-SkipProviderConfiguration",
                 "-SkillsRoot", str(root / "skills"), "-Confirm:$false"],
                cwd=ROOT, env=env, text=True, capture_output=True, timeout=90,
            )
            self.assertEqual(whatif.returncode, 0, whatif.stdout + whatif.stderr)
            self.assertIn("no files or configuration were changed", whatif.stdout)
            self.assertIn("[SKIPPED] Provider configuration", whatif.stdout)
            self.assertFalse((root / "skills").exists())
            self.assertFalse((root / "graph").exists())
            self.assertFalse((root / "context").exists())
            self.assertFalse((root / "codex").exists())

    def test_redirected_or_ci_execution_never_reaches_prompt_paths(self) -> None:
        with tempfile.TemporaryDirectory(prefix="afyx-tui-redirected-") as raw:
            root = Path(raw)
            env = os.environ.copy()
            env.update(
                {
                    "USERPROFILE": str(root / "profile"),
                    "HOME": str(root / "profile"),
                    "APPDATA": str(root / "appdata"),
                    "CODEX_HOME": str(root / "codex"),
                    "AFYX_GRAPH_RUNTIME_ROOT": str(root / "graph"),
                    "AFYX_CONTEXT_RUNTIME_ROOT": str(root / "context"),
                    "NO_COLOR": "1",
                }
            )
            command = [
                self.shell,
                "-NoProfile",
                "-NonInteractive",
                "-File",
                str(ROOT / "install.ps1"),
                "-SkipProviderConfiguration",
                "-Confirm:$false",
            ]
            for ci in (None, "1"):
                current_env = {**env}
                if ci:
                    current_env["CI"] = ci
                else:
                    current_env.pop("CI", None)
                result = subprocess.run(
                    command,
                    cwd=ROOT,
                    env=current_env,
                    stdin=subprocess.DEVNULL,
                    text=True,
                    capture_output=True,
                    timeout=90,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                output = result.stdout + result.stderr
                self.assertNotIn("Provider selection:", output)
                self.assertNotIn("[I] Install", output)
                self.assertNotIn("[U] Update", output)
                self.assertNotIn("[R] Repair", output)

    @unittest.skipUnless(os.name == "nt", "healthy Context action fixture uses the native Windows installer")
    def test_healthy_context_action_is_disclosed_and_whatif_is_immutable(self) -> None:
        with tempfile.TemporaryDirectory(prefix="afyx-tui-context-plan-") as raw:
            root = Path(raw)
            runtime = root / "context"
            env = {
                **os.environ,
                "USERPROFILE": str(root / "profile"),
                "HOME": str(root / "profile"),
                "APPDATA": str(root / "appdata"),
                "CODEX_HOME": str(root / "codex"),
                "CI": "1",
                "NO_COLOR": "1",
            }
            install = subprocess.run(
                [self.shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "scripts" / "install-afyx-context.ps1"),
                 "-RuntimeRoot", str(runtime), "-Confirm:$false"],
                cwd=ROOT, env=env, text=True, capture_output=True, timeout=90,
            )
            self.assertEqual(install.returncode, 0, install.stdout + install.stderr)
            before = {path.relative_to(runtime): path.read_bytes() for path in runtime.rglob("*") if path.is_file()}
            result = subprocess.run(
                [self.shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "install.ps1"),
                 "-WhatIf", "-Preset", "custom", "-CustomComponent", "afyx-context",
                 "-Provider", "codex", "-SkipProviderConfiguration", "-SkillsRoot", str(root / "skills"),
                 "-ContextRuntimeRoot", str(runtime), "-Confirm:$false"],
                cwd=ROOT, env=env, text=True, capture_output=True, timeout=90,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("[PLANNED] afyx-context - action=update", result.stdout)
            self.assertIn("[PLANNED] Afyx Context Engine - outcome=update", result.stdout)
            after = {path.relative_to(runtime): path.read_bytes() for path in runtime.rglob("*") if path.is_file()}
            self.assertEqual(after, before)

    def test_terminal_interactive_safeguards_prevent_overrides_from_bypassing_ci_plain_or_redirect(self) -> None:
        script = f"""
Import-Module '{MODULE}' -Force

$plainOverride = Test-AfyxInteractiveTerminal -ForceInteractive -ForcePlain
$plainEnv = & {{ $env:AFYX_FORCE_INTERACTIVE='1'; Test-AfyxInteractiveTerminal -ForcePlain }}

$ciOverride = & {{ $env:CI='1'; Test-AfyxInteractiveTerminal -ForceInteractive }}
$ciEnv = & {{ $env:CI='1'; $env:AFYX_FORCE_INTERACTIVE='1'; Test-AfyxInteractiveTerminal }}

$redirectOverride = & {{ $env:CI=$null; [Console]::IsOutputRedirected -and (Test-AfyxInteractiveTerminal -ForceInteractive) -eq $false }}
$redirectEnv = & {{ $env:CI=$null; $env:AFYX_FORCE_INTERACTIVE='1'; [Console]::IsOutputRedirected -and (Test-AfyxInteractiveTerminal) -eq $false }}

[pscustomobject]@{{
    PlainOverride = $plainOverride
    PlainEnv = $plainEnv
    CiOverride = $ciOverride
    CiEnv = $ciEnv
    RedirectOverrideBlocked = $redirectOverride
    RedirectEnvBlocked = $redirectEnv
}} | ConvertTo-Json -Compress
"""
        result = self.run_ps(script)
        self.assertIn('"PlainOverride":false', result.stdout)
        self.assertIn('"PlainEnv":false', result.stdout)
        self.assertIn('"CiOverride":false', result.stdout)
        self.assertIn('"CiEnv":false', result.stdout)
        self.assertIn('"RedirectOverrideBlocked":true', result.stdout)
        self.assertIn('"RedirectEnvBlocked":true', result.stdout)

    def test_zero_argument_strict_mode_contract_under_interactive_terminal(self) -> None:
        script = """
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Test-Contract {
    param([switch]$Force)
    $terminal = [pscustomobject]@{ Interactive = $true; Ansi = $false; Width = 80 }
    $ValidateOnly = $false
    $WhatIfPreference = $false
    $explicitSelection = @(
        @('Preset', 'CustomComponent', 'ComponentAction', 'Provider', 'Force', 'UpdateInstalled', 'InstallUsageTracker', 'SkipUsageTracker', 'SkipProviderConfiguration', 'Confirm') |
            Where-Object { $PSBoundParameters.ContainsKey($_) }
    )
    $wizardMode = $terminal.Interactive -and -not $ValidateOnly -and -not $WhatIfPreference -and $explicitSelection.Count -eq 0
    return [pscustomobject]@{
        IsArray = ($explicitSelection -is [System.Array])
        Count = $explicitSelection.Count
        WizardMode = $wizardMode
    }
}
$zeroArg = Test-Contract
$withArg = Test-Contract -Force
[pscustomobject]@{ ZeroArg = $zeroArg; WithArg = $withArg } | ConvertTo-Json -Compress
"""
        result = self.run_ps(script)
        self.assertIn('"ZeroArg":{"IsArray":true,"Count":0,"WizardMode":true}', result.stdout)
        self.assertIn('"WithArg":{"IsArray":true,"Count":1,"WizardMode":false}', result.stdout)

    @unittest.skipUnless(os.name == "nt", "Windows PowerShell 5.1 is native to Windows")
    def test_zero_argument_strict_mode_contract_in_windows_powershell_51(self) -> None:
        windows_powershell = shutil.which("powershell.exe")
        if not windows_powershell:
            self.skipTest("Windows PowerShell 5.1 unavailable")
        script = """
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Test-Contract {
    param([switch]$Force)
    $terminal = [pscustomobject]@{ Interactive = $true; Ansi = $false; Width = 80 }
    $ValidateOnly = $false
    $WhatIfPreference = $false
    $explicitSelection = @(
        @('Preset', 'CustomComponent', 'ComponentAction', 'Provider', 'Force', 'UpdateInstalled', 'InstallUsageTracker', 'SkipUsageTracker', 'SkipProviderConfiguration', 'Confirm') |
            Where-Object { $PSBoundParameters.ContainsKey($_) }
    )
    $wizardMode = $terminal.Interactive -and -not $ValidateOnly -and -not $WhatIfPreference -and $explicitSelection.Count -eq 0
    return [pscustomobject]@{
        IsArray = ($explicitSelection -is [System.Array])
        Count = $explicitSelection.Count
        WizardMode = $wizardMode
    }
}
$zeroArg = Test-Contract
$withArg = Test-Contract -Force
if (-not $zeroArg.WizardMode -or $zeroArg.Count -ne 0) { throw 'ZeroArg failed' }
if ($withArg.WizardMode -or $withArg.Count -ne 1) { throw 'WithArg failed' }
'PS51_CONTRACT_PASS'
"""
        result = subprocess.run(
            [windows_powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PS51_CONTRACT_PASS", result.stdout)

    def test_default_invocation_with_zero_arguments_under_redirected_io(self) -> None:
        with tempfile.TemporaryDirectory(prefix="afyx-tui-default-") as raw:
            root = Path(raw)
            fake_bin = root / "bin"
            fake_bin.mkdir(parents=True)
            if os.name == "nt":
                (fake_bin / "codex.cmd").write_text("@echo codex-test\r\n", encoding="utf-8")
            else:
                codex = fake_bin / "codex"
                codex.write_text("#!/bin/sh\necho codex-test\n", encoding="utf-8")
                codex.chmod(codex.stat().st_mode | 0o755)
            env = os.environ.copy()
            env.update(
                {
                    "PATH": f"{fake_bin}{os.pathsep}{env.get('PATH', '')}",
                    "USERPROFILE": str(root / "profile"),
                    "HOME": str(root / "profile"),
                    "APPDATA": str(root / "appdata"),
                    "CODEX_HOME": str(root / "codex"),
                    "AFYX_GRAPH_RUNTIME_ROOT": str(root / "graph"),
                    "AFYX_CONTEXT_RUNTIME_ROOT": str(root / "context"),
                    "NO_COLOR": "1",
                }
            )
            result = subprocess.run(
                [self.shell, "-NoProfile", "-File", str(ROOT / "install.ps1")],
                cwd=ROOT,
                env=env,
                stdin=subprocess.DEVNULL,
                text=True,
                capture_output=True,
                timeout=60,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertNotIn("The property 'Count' cannot be found on this object", result.stdout + result.stderr)
            self.assertIn("Interactive Installer | Midnight Circuit", result.stdout)
            self.assertIn("Component Inventory", result.stdout)
            self.assertIn("Prerequisite Inventory", result.stdout)
            self.assertIn("Provider Plan", result.stdout)
            self.assertIn("Installation Receipt", result.stdout)
            self.assertIn("existing healthy components were preserved", result.stdout)
            self.assertFalse((root / "skills").exists())
            self.assertFalse((root / "codex").exists())
            self.assertFalse((root / "graph").exists())

    @unittest.skipUnless(os.name == "nt", "Windows PowerShell 5.1 is native to Windows")
    def test_default_invocation_with_zero_arguments_in_windows_powershell_51(self) -> None:
        windows_powershell = shutil.which("powershell.exe")
        if not windows_powershell:
            self.skipTest("Windows PowerShell 5.1 unavailable")
        with tempfile.TemporaryDirectory(prefix="afyx-tui-default-ps51-") as raw:
            root = Path(raw)
            fake_bin = root / "bin"
            fake_bin.mkdir(parents=True)
            (fake_bin / "codex.cmd").write_text("@echo codex-test\r\n", encoding="utf-8")
            env = os.environ.copy()
            env.update(
                {
                    "PATH": f"{fake_bin}{os.pathsep}{env.get('PATH', '')}",
                    "USERPROFILE": str(root / "profile"),
                    "HOME": str(root / "profile"),
                    "APPDATA": str(root / "appdata"),
                    "CODEX_HOME": str(root / "codex"),
                    "AFYX_GRAPH_RUNTIME_ROOT": str(root / "graph"),
                    "AFYX_CONTEXT_RUNTIME_ROOT": str(root / "context"),
                    "NO_COLOR": "1",
                }
            )
            result = subprocess.run(
                [windows_powershell, "-NoProfile", "-File", str(ROOT / "install.ps1")],
                cwd=ROOT,
                env=env,
                stdin=subprocess.DEVNULL,
                text=True,
                capture_output=True,
                timeout=60,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertNotIn("The property 'Count' cannot be found on this object", result.stdout + result.stderr)
            self.assertIn("Interactive Installer | Midnight Circuit", result.stdout)
            self.assertIn("Installation Receipt", result.stdout)
            self.assertIn("existing healthy components were preserved", result.stdout)
            self.assertFalse((root / "skills").exists())

    def test_native_host_keyinfo_navigation_and_selection(self) -> None:
        script = f"""
Import-Module '{MODULE}' -Force
$terminal = [pscustomobject]@{{ Ansi = $false; Interactive = $true; Width = 80 }}
$options = @(
    [pscustomobject]@{{ Id = 'opt1'; Label = 'Option 1'; Enabled = $true }},
    [pscustomobject]@{{ Id = 'opt2'; Label = 'Option 2'; Enabled = $false }},
    [pscustomobject]@{{ Id = 'opt3'; Label = 'Option 3'; Enabled = $true }}
)
$keys = [Collections.Queue]::new()
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(40, [char]0, [System.Management.Automation.Host.ControlKeyStates]0, $true))
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(13, [char]13, [System.Management.Automation.Host.ControlKeyStates]0, $true))
Read-AfyxSingleChoice -Prompt test -Options $options -DefaultId opt1 -Terminal $terminal -ReadKey {{$keys.Dequeue()}} -NoRender
"""
        result = self.run_ps(script)
        self.assertEqual(result.stdout.strip(), "opt3")

    def test_native_host_keyinfo_numeric_selection_and_disabled_guard(self) -> None:
        script = f"""
Import-Module '{MODULE}' -Force
$terminal = [pscustomobject]@{{ Ansi = $false; Interactive = $true; Width = 80 }}
$options = @(
    [pscustomobject]@{{ Id = 'opt1'; Label = 'Option 1'; Enabled = $true }},
    [pscustomobject]@{{ Id = 'opt2'; Label = 'Option 2'; Enabled = $false }},
    [pscustomobject]@{{ Id = 'opt3'; Label = 'Option 3'; Enabled = $true }}
)
$keys1 = [Collections.Queue]::new()
$keys1.Enqueue([System.Management.Automation.Host.KeyInfo]::new(51, [char]'3', [System.Management.Automation.Host.ControlKeyStates]0, $true))
$r1 = Read-AfyxSingleChoice -Prompt test -Options $options -DefaultId opt1 -Terminal $terminal -ReadKey {{$keys1.Dequeue()}} -NoRender

$keys2 = [Collections.Queue]::new()
$keys2.Enqueue([System.Management.Automation.Host.KeyInfo]::new(99, [char]'3', [System.Management.Automation.Host.ControlKeyStates]0, $true))
$r2 = Read-AfyxSingleChoice -Prompt test -Options $options -DefaultId opt1 -Terminal $terminal -ReadKey {{$keys2.Dequeue()}} -NoRender

$keys3 = [Collections.Queue]::new()
$keys3.Enqueue([System.Management.Automation.Host.KeyInfo]::new(50, [char]'2', [System.Management.Automation.Host.ControlKeyStates]0, $true))
$keys3.Enqueue([System.Management.Automation.Host.KeyInfo]::new(13, [char]13, [System.Management.Automation.Host.ControlKeyStates]0, $true))
$r3 = Read-AfyxSingleChoice -Prompt test -Options $options -DefaultId opt1 -Terminal $terminal -ReadKey {{$keys3.Dequeue()}} -NoRender

[pscustomobject]@{{ Standard = $r1; Numpad = $r2; DisabledIgnored = $r3 }} | ConvertTo-Json -Compress
"""
        result = self.run_ps(script)
        self.assertIn('"Standard":"opt3"', result.stdout)
        self.assertIn('"Numpad":"opt3"', result.stdout)
        self.assertIn('"DisabledIgnored":"opt1"', result.stdout)

    def test_native_host_keyinfo_multiselect_spacebar_toggle(self) -> None:
        script = f"""
Import-Module '{MODULE}' -Force
$terminal = [pscustomobject]@{{ Ansi = $false; Interactive = $true; Width = 80 }}
$options = @(
    [pscustomobject]@{{ Id = 'comp_a'; Label = 'Component A'; Enabled = $true }},
    [pscustomobject]@{{ Id = 'comp_b'; Label = 'Component B'; Enabled = $true }}
)
$keys = [Collections.Queue]::new()
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(32, [char]' ', [System.Management.Automation.Host.ControlKeyStates]0, $true))
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(40, [char]0, [System.Management.Automation.Host.ControlKeyStates]0, $true))
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(32, [char]' ', [System.Management.Automation.Host.ControlKeyStates]0, $true))
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(13, [char]13, [System.Management.Automation.Host.ControlKeyStates]0, $true))

@(Read-AfyxMultiChoice -Prompt test -Options $options -Terminal $terminal -ReadKey {{$keys.Dequeue()}} -NoRender) -join ','
"""
        result = self.run_ps(script)
        self.assertEqual(result.stdout.strip(), "comp_a,comp_b")

    def test_native_host_keyinfo_escape_and_q_cancels_before_mutation(self) -> None:
        script = f"""
Import-Module '{MODULE}' -Force
$terminal = [pscustomobject]@{{ Ansi = $false; Interactive = $true; Width = 80 }}
$options = @([pscustomobject]@{{ Id = 'opt1'; Label = 'Option 1'; Enabled = $true }})

$escCancelled = $false
try {{
    Read-AfyxSingleChoice -Prompt test -Options $options -Terminal $terminal -ReadKey {{
        [System.Management.Automation.Host.KeyInfo]::new(27, [char]27, [System.Management.Automation.Host.ControlKeyStates]0, $true)
    }} -NoRender
}} catch [OperationCanceledException] {{
    $escCancelled = $true
}}

$qCancelled = $false
try {{
    Read-AfyxSingleChoice -Prompt test -Options $options -Terminal $terminal -ReadKey {{
        [System.Management.Automation.Host.KeyInfo]::new(81, [char]'q', [System.Management.Automation.Host.ControlKeyStates]0, $true)
    }} -NoRender
}} catch [OperationCanceledException] {{
    $qCancelled = $true
}}

[pscustomobject]@{{ Esc = $escCancelled; Q = $qCancelled }} | ConvertTo-Json -Compress
"""
        result = self.run_ps(script)
        self.assertIn('"Esc":true', result.stdout)
        self.assertIn('"Q":true', result.stdout)

    def test_native_host_keyinfo_unsupported_and_keyup_events_are_safely_ignored(self) -> None:
        script = f"""
Import-Module '{MODULE}' -Force
$terminal = [pscustomobject]@{{ Ansi = $false; Interactive = $true; Width = 80 }}
$options = @(
    [pscustomobject]@{{ Id = 'opt1'; Label = 'Option 1'; Enabled = $true }},
    [pscustomobject]@{{ Id = 'opt2'; Label = 'Option 2'; Enabled = $true }}
)
$keys = [Collections.Queue]::new()
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(13, [char]13, [System.Management.Automation.Host.ControlKeyStates]0, $false))
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(9, [char]9, [System.Management.Automation.Host.ControlKeyStates]0, $true))
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(112, [char]0, [System.Management.Automation.Host.ControlKeyStates]0, $true))
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(40, [char]0, [System.Management.Automation.Host.ControlKeyStates]0, $true))
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(13, [char]13, [System.Management.Automation.Host.ControlKeyStates]0, $true))

Read-AfyxSingleChoice -Prompt test -Options $options -DefaultId opt1 -Terminal $terminal -ReadKey {{$keys.Dequeue()}} -NoRender
"""
        result = self.run_ps(script)
        self.assertEqual(result.stdout.strip(), "opt2")

    @unittest.skipUnless(os.name == "nt", "Windows PowerShell 5.1 is native to Windows")
    def test_native_host_keyinfo_compatibility_in_windows_powershell_51(self) -> None:
        windows_powershell = shutil.which("powershell.exe")
        if not windows_powershell:
            self.skipTest("Windows PowerShell 5.1 unavailable")
        script = f"""
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module '{MODULE}' -Force
$terminal = [pscustomobject]@{{ Ansi = $false; Interactive = $true; Width = 80 }}
$options = @(
    [pscustomobject]@{{ Id = 'opt1'; Label = 'Option 1'; Enabled = $true }},
    [pscustomobject]@{{ Id = 'opt2'; Label = 'Option 2'; Enabled = $true }}
)
$keys = [Collections.Queue]::new()
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(13, [char]13, [System.Management.Automation.Host.ControlKeyStates]0, $false))
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(40, [char]0, [System.Management.Automation.Host.ControlKeyStates]0, $true))
$keys.Enqueue([System.Management.Automation.Host.KeyInfo]::new(13, [char]13, [System.Management.Automation.Host.ControlKeyStates]0, $true))

$selected = Read-AfyxSingleChoice -Prompt test -Options $options -DefaultId opt1 -Terminal $terminal -ReadKey {{$keys.Dequeue()}} -NoRender
if ($selected -ne 'opt2') {{ throw "PS5.1 KeyInfo expected 'opt2' but got '$selected'" }}
'PS51_KEYINFO_PASS'
"""
        result = subprocess.run(
            [windows_powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PS51_KEYINFO_PASS", result.stdout)

    def test_installer_keeps_wizard_separate_from_lifecycle_engine(self) -> None:
        source = (ROOT / "install.ps1").read_text(encoding="utf-8")
        self.assertIn("AfyxTerminal.psm1", source)
        self.assertIn("Read-AfyxSingleChoice", source)
        self.assertIn("Read-AfyxMultiChoice", source)
        self.assertLess(source.index("Read-AfyxConfirmation"), source.index("$summary = [ordered]@{}"))
        self.assertLess(source.index("$actionDecisions = [ordered]@{}"), source.index("Read-AfyxConfirmation -Prompt 'Apply the reviewed plan?'"))
        self.assertIn("$contextAction = if ($controlPlan) { [string]$actionDecisions['afyx-context'] }", source)
        self.assertNotIn("[Console]::IsInputRedirected", source)
        self.assertIn("-and $terminal.Interactive", source)
        self.assertIn("Get-AfyxControlPlan", source)
        self.assertIn("Install-AfyxSkillTransaction", source)
        self.assertNotIn("Spectre", source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
