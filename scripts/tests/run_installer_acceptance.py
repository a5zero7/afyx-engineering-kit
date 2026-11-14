"""Exercise the real CLI/TUI/native backend in private OS profiles and a native PTY.

Run against a committed staged npm tarball for final cross-platform acceptance.
Without --tarball, results are explicitly working-source diagnostics only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from installer_terminal import TerminalProcess

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
ENTER, DOWN, HOME, END = b"\r", b"\x1b[B", b"\x1b[H", b"\x1b[F"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--node", default=shutil.which("node"))
    parser.add_argument("--shell", choices=["powershell", "pwsh", "bash"], default="pwsh" if os.name == "nt" else "bash")
    parser.add_argument("--tarball")
    parser.add_argument("--npx-cli")
    parser.add_argument("--source", default=str(ROOT))
    parser.add_argument("--legacy-navigation", action="store_true")
    parser.add_argument("--plain", action="store_true", help="Exercise the shared NO_COLOR numbered wizard")
    parser.add_argument("--resize", action="store_true", help="Capture a real terminal resize before selection")
    parser.add_argument("--reduced-motion", action="store_true")
    parser.add_argument("--cases", default="minimal,recommended,custom,full,reinstall")
    args = parser.parse_args()
    cases = args.cases.split(",")
    if any(case not in {"minimal", "recommended", "custom", "full", "reinstall"} for case in cases):
        parser.error("Unknown acceptance case")
    source_root = Path(args.source).resolve()
    output = Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=True)
    fixture = Path(tempfile.mkdtemp(prefix="afyx-ui-v2-", dir=str(output) if os.name == "nt" else None)).resolve()
    profile, project, tools = (fixture / name for name in ["profile", "project", "tools"])
    for path in [profile, project, tools, fixture / "temp"]: path.mkdir()
    node = tools / ("node.exe" if os.name == "nt" else "node")
    if os.name == "nt": shutil.copy2(args.node, node)
    else: node.symlink_to(Path(args.node).resolve())
    env = {key: value for key, value in os.environ.items() if key.upper() not in ["PATH", "CI", "NO_COLOR", "AFYX_PLAIN_OUTPUT", "AFYX_REDUCED_MOTION"]}
    env.update(HOME=str(profile), USERPROFILE=str(profile), XDG_CONFIG_HOME=str(profile / ".config"),
               CODEX_HOME=str(profile / ".codex"), AFYX_GEMINI_HOME=str(profile / ".gemini"), CLAUDE_CONFIG_DIR=str(profile / ".claude"),
               APPDATA=str(profile / "AppData/Roaming"), LOCALAPPDATA=str(profile / "AppData/Local"),
               AFYX_INSTALL_ROOT=str(profile / ".afyx"), AFYX_GRAPH_RUNTIME_ROOT=str(profile / ".afyx/graph"),
               AFYX_CONTEXT_RUNTIME_ROOT=str(profile / ".afyx/context"), AFYX_FORGE_RUNTIME_ROOT=str(profile / ".afyx/forge"),
               AFYX_HOST_BRIDGE_RUNTIME_ROOT=str(profile / ".afyx/host-bridge"), AFYX_BACKUP_ROOT=str(fixture / "backups"),
               AFYX_GRAPH_BIN_DIR=str(fixture / "bin"), AFYX_CONTEXT_OPT_IN="0", TERM="xterm-256color", COLORTERM="truecolor",
               TEMP=str(fixture / "temp"), TMP=str(fixture / "temp"), TMPDIR=str(fixture / "temp"),
               npm_config_cache=str(fixture / "cache"), npm_config_prefix=str(fixture / "prefix"), npm_config_offline="true",
               npm_config_registry="http://127.0.0.1:9/", npm_config_yes="true", npm_config_audit="false", npm_config_fund="false",
               npm_config_userconfig=str(fixture / "empty-npmrc"), npm_config_globalconfig=str(fixture / "empty-global-npmrc"))
    for name in ["empty-npmrc", "empty-global-npmrc"]: (fixture / name).write_text("")
    if args.plain: env.update(NO_COLOR="", AFYX_PLAIN_OUTPUT="1")
    if args.reduced_motion: env["AFYX_REDUCED_MOTION"] = "1"
    if os.name == "nt":
        shell = shutil.which(args.shell + ".exe")
        if not shell: raise RuntimeError(f"Required real shell unavailable: {args.shell}")
        paths = [tools, Path(os.environ["SystemRoot"]) / "System32", Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0"]
        git = shutil.which("git")
        if git: paths.append(Path(git).parent)
        if args.shell == "pwsh": paths.append(Path(shell).parent)
        env["PATH"] = os.pathsep.join(str(x) for x in paths)
    else:
        shell = "/bin/bash"; env["PATH"] = f"{tools}:/usr/bin:/bin:/usr/sbin:/sbin"
    if args.tarball:
        if not args.npx_cli: raise RuntimeError("--npx-cli is required for actual local tarball execution")
        argv = [str(args.npx_cli), "--offline", f"--package={Path(args.tarball).resolve().as_uri()}", "afyx-engineering-kit"]
        artifact_sha = digest(args.tarball)
    else:
        argv = [str(source_root / "bin/afyx-engineering-kit.mjs")]; artifact_sha = None
    argv += ["install", "--ui", "plain" if args.plain else "tui", "--skills-root", str(fixture / "skills"), "--workspace-root", str(project), "--offline", "--no-build-fallback"]
    command = [str(node), *argv]
    if os.name == "nt":
        invocation = fixture / "invocation.json"; invocation.write_text(json.dumps(dict(node=str(node), args=argv)), encoding="utf-8")
        parent = fixture / "parent.ps1"
        parent.write_text("param([string]$Invocation)\n$data=Get-Content -LiteralPath $Invocation -Raw | ConvertFrom-Json\n$arguments=@($data.args | ForEach-Object {[string]$_})\n& $data.node @arguments\nexit $LASTEXITCODE\n", encoding="utf-8")
        command = [shell, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(parent), "-Invocation", str(invocation)]
    else:
        # A real Bash parent; argv stays positional data, never interpolated shell code.
        command = [shell, "--noprofile", "--norc", "-c", 'exec "$@"', "afyx-acceptance", *command]
    records = []
    marker = source_root / '.afyx-source-revision'
    source_revision = marker.read_text().strip() if marker.is_file() else ''
    if not re.fullmatch(r'[0-9a-f]{40}', source_revision):
        source_revision = subprocess.check_output(["git", "-C", str(source_root), "rev-parse", "HEAD"], text=True).strip()
    record = {"schema": "afyx-installer-pty-acceptance/v1", "fixture": str(fixture), "platform": sys.platform,
              "parentShell": shell, "command": command, "nodeVersion": subprocess.check_output([str(node), "--version"], text=True).strip(),
              "packageArtifactSha256": artifact_sha, "sourceMode": "IMMUTABLE_NPM_TARBALL" if args.tarball else "WORKING_SOURCE_DIAGNOSTIC",
              "sourceRoot": str(source_root), "sourceRevision": source_revision,
              "dailyConfigurationWrites": False, "providerConfiguration": "EXPLICITLY_SKIPPED",
              "ui": "plain" if args.plain else "tui", "reducedMotion": args.reduced_motion, "cases": records}
    receipt = output / "acceptance-result.json"
    receipt.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    for case in cases:
        preset = "full" if case == "reinstall" else case
        previous_logs = set((fixture / "temp").glob("afyx-installer-execution-*/backend.log"))
        started = time.monotonic(); terminal = TerminalProcess(command, project, env)
        case_dir = output / case; case_dir.mkdir(exist_ok=True)
        result = {"case": case, "preset": preset, "status": "RUNNING", "frames": []}; records.append(result)
        def frame(stage, token):
            screen = terminal.wait_for(token, history=args.plain,
                                       reject=("Finish — FAILED", "Finish - FAILED", "Verification: NOT TESTED / FAILED", "FAILED — backend plan unavailable", "FAILED - backend plan unavailable"))
            path = case_dir / f"{stage}.txt"; path.write_text(screen + "\n", encoding="utf-8")
            result["frames"].append({"stage": stage, "path": str(path), "sha256": digest(path)})
            receipt.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        try:
            frame("01-detect", "Continue")
            if args.resize and not args.plain:
                terminal.resize(90, 28); frame("01-detect-90x28", "Continue")
                terminal.resize(120, 35); frame("01-detect-120x35", "Continue")
            terminal.send(ENTER)
            frame("02-select", "Skip provider integration"); terminal.send((b'' if args.legacy_navigation or args.plain else END) + ENTER)
            terminal.wait_for("Recommended")
            preset_index = {"recommended": 0, "minimal": 1, "full": 2, "custom": 3}[preset]
            terminal.send((str(preset_index + 1).encode() if args.plain else (b'' if args.legacy_navigation else HOME) + DOWN * preset_index) + ENTER)
            if preset == "custom":
                terminal.wait_for("Space: toggle", history=args.plain)
                terminal.send((b"1,2" if args.plain else b" " + DOWN + b" ") + ENTER)
            frame("03-configure", "Global provider scope"); terminal.send(ENTER)
            frame("04-review", "Apply exactly"); terminal.send(ENTER)
            frame("05-finish", "Finish - PASS" if args.plain else "Finish — PASS")
            assert "verify exit=0" in (terminal.raw.decode("utf-8", "replace") if args.plain else terminal.screen()), terminal.screen()
            terminal.send(ENTER)
            deadline = time.monotonic() + 20
            while terminal.poll() is None and time.monotonic() < deadline: terminal.pump()
            assert terminal.poll() == 0, terminal.screen()
            launches = []
            for log in set((fixture / "temp").glob("afyx-installer-execution-*/backend.log")) - previous_logs:
                first = log.read_text(encoding="utf-8").splitlines()[0]
                assert first.startswith("Source root: "), first
                launch_root = Path(first.removeprefix("Source root: ")).resolve()
                executable = launch_root / "bin/afyx-engineering-kit.mjs"
                launch = dict(root=str(launch_root), executable=str(executable), sha256=digest(executable), backendLog=str(log))
                if args.tarball:
                    launch_root.relative_to(fixture / "cache")
                    launch["sourceRevision"] = (launch_root / ".afyx-source-revision").read_text().strip()
                    assert launch["sourceRevision"] == record["sourceRevision"], launch
                assert executable.read_bytes().replace(b"\r\n", b"\n") == (source_root / "bin/afyx-engineering-kit.mjs").read_bytes().replace(b"\r\n", b"\n"), launch
                launches.append(launch)
            assert launches, "No actual installed/source executable identity was recorded"
            result["launches"] = launches
            result.update(status="PASS", exitCode=terminal.poll(), elapsedSeconds=round(time.monotonic() - started, 3))
        except Exception as error:
            result.update(status="FAIL", error=f"{type(error).__name__}: {error}", elapsedSeconds=round(time.monotonic() - started, 3))
            (case_dir / "failure-screen.txt").write_text(terminal.screen(), encoding="utf-8")
            raise
        finally:
            terminal.save(case_dir / "terminal.ansi")
            terminal.close()
            receipt.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "PASS", "cases": len(records), "receipt": str(receipt)}))


if __name__ == "__main__":
    main()
