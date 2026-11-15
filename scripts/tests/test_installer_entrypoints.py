"""Native bare entrypoints display the canonical renderer and cancel without apply."""
import os
import pathlib
import shutil
import tempfile
import unittest

from installer_terminal import TerminalProcess

ROOT = pathlib.Path(__file__).resolve().parents[2]


class NativeEntrypointTests(unittest.TestCase):
    def test_bare_native_entrypoints_delegate_and_cancel_without_installation(self):
        shells = ['powershell', 'pwsh'] if os.name == 'nt' else ['bash']
        for shell in shells:
            with self.subTest(shell=shell), tempfile.TemporaryDirectory(prefix='afyx-native-entry-') as temporary:
                executable = shutil.which(shell)
                if not executable:
                    self.skipTest(f'{shell} unavailable')
                base = pathlib.Path(temporary).resolve()
                profile, project = base / 'profile', base / 'project'
                profile.mkdir(); project.mkdir()
                env = {key: value for key, value in os.environ.items()
                       if key.upper() not in ['CI', 'NO_COLOR', 'AFYX_PLAIN_OUTPUT', 'AFYX_INSTALL_UI_OWNER']}
                env.update(HOME=str(profile), USERPROFILE=str(profile), CODEX_HOME=str(profile / '.codex'),
                           APPDATA=str(profile / 'AppData/Roaming'), LOCALAPPDATA=str(profile / 'AppData/Local'),
                           AFYX_GEMINI_HOME=str(profile / '.gemini'), CLAUDE_CONFIG_DIR=str(profile / '.claude'),
                           AFYX_INSTALL_ROOT=str(profile / '.afyx'), AFYX_CONTEXT_OPT_IN='0', TERM='xterm-256color')
                command = [executable, '-NoProfile', '-File', str(ROOT / 'install.ps1')] if os.name == 'nt' else [executable, str(ROOT / 'install.sh')]
                terminal = TerminalProcess(command, project, env)
                try:
                    screen = terminal.wait_for('Continue to selection', timeout=30)
                    self.assertIn('Unified Installer', screen)
                    self.assertIn('Shell:', screen)
                    self.assertNotIn('MIDNIGHT CIRCUIT | ALPHA INSTALLER', screen)
                    terminal.send(b'\x1b')
                    terminal.wait_for('Installation canceled without changes.', timeout=10)
                    self.assertFalse((profile / '.afyx').exists())
                    self.assertFalse((profile / '.agents/skills').exists())
                finally:
                    terminal.close()


if __name__ == '__main__':
    unittest.main()
