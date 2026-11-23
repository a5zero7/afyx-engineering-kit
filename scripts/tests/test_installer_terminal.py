"""Protect terminal capture accuracy without starting a host process."""
import contextlib
import codecs
import os
import unittest
from unittest.mock import Mock, patch

from installer_terminal import TerminalProcess


class TerminalResizeTests(unittest.TestCase):
    def test_resize_preserves_visible_content_and_bounds_the_cursor(self):
        terminal = TerminalProcess.__new__(TerminalProcess)
        terminal.columns, terminal.rows = 12, 4
        terminal.cells = [list('AFYX        ')] + [list('            ') for _ in range(3)]
        terminal.row, terminal.column = 3, 11
        terminal.master, terminal.console = 0, 0
        terminal.Coord = lambda width, height: (width, height)
        terminal.kernel = Mock()
        terminal.kernel.ResizePseudoConsole.return_value = 0
        with contextlib.ExitStack() as stack:
            if os.name != 'nt':
                stack.enter_context(patch('fcntl.ioctl', return_value=0))
            terminal.resize(8, 3)
            self.assertEqual(''.join(terminal.cells[0]).strip(), 'AFYX')
            self.assertEqual((terminal.row, terminal.column), (2, 7))
            terminal.resize(12, 4)
        self.assertEqual(''.join(terminal.cells[0]).strip(), 'AFYX')
        self.assertEqual(len(terminal.cells), 4)
        self.assertTrue(all(len(line) == 12 for line in terminal.cells))


class TerminalProtocolTests(unittest.TestCase):
    def terminal(self, initial='Recommended provider', chunks=()):
        terminal = TerminalProcess.__new__(TerminalProcess)
        terminal.columns, terminal.rows = 120, 35
        terminal.cells = [[' '] * 120 for _ in range(35)]
        terminal.row = terminal.column = 0
        terminal.pending = ''
        terminal.decoder = codecs.getincrementaldecoder('utf-8')('replace')
        terminal.raw = bytearray(initial.encode())
        terminal.started, terminal.events = 0, []
        terminal._screen(initial)
        terminal.poll = lambda: None
        terminal.master = 123
        clock = [0.0]
        pending = list(chunks)

        def pump():
            clock[0] += 0.01
            if pending:
                data = pending.pop(0)
                terminal.raw.extend(data)
                terminal._screen(terminal.decoder.decode(data))

        terminal.pump = pump
        return terminal, clock

    def test_unique_preset_readiness_waits_for_new_screen_after_provider_input(self):
        terminal, clock = self.terminal(chunks=[b'\r\nWorking', b'\r\nChoose a component pre', b'set.'])
        marker = len(terminal.raw)
        with patch('installer_terminal.time.monotonic', side_effect=lambda: clock[0]):
            screen = terminal.wait_for('Choose a component preset.', after=marker, timeout=0.1)
        self.assertIn('Choose a component preset.', screen)
        self.assertEqual(clock[0], 0.03)
        self.assertEqual(terminal.events[-1]['after'], marker)
        self.assertGreater(terminal.events[-1]['outputOffset'], marker)

    def test_unrelated_fresh_output_does_not_make_a_stale_token_ready(self):
        terminal, clock = self.terminal(chunks=[b'\r\nActivity update'])
        with patch('installer_terminal.time.monotonic', side_effect=lambda: clock[0]):
            with self.assertRaises(TimeoutError):
                terminal.wait_for('Recommended', after=len(terminal.raw), timeout=0.04)
        self.assertEqual(terminal.events, [])

    def test_fragmented_escape_sequences_and_preset_text_form_one_fresh_state(self):
        terminal, clock = self.terminal(chunks=[b'\x1b[2', b'J\x1b[HChoose a component ', b'preset.'])
        with patch('installer_terminal.time.monotonic', side_effect=lambda: clock[0]):
            screen = terminal.wait_for('Choose a component preset.', after=len(terminal.raw), timeout=0.1)
        self.assertNotIn('Recommended provider', screen)
        self.assertIn('Choose a component preset.', screen)

    def test_input_bytes_keep_order_and_return_the_observed_output_checkpoint(self):
        terminal, clock = self.terminal()
        data = b'\x1b[H\x1b[B\x1b[B\r'
        with patch('installer_terminal.os.name', 'posix'), patch('installer_terminal.os.write', return_value=len(data)) as write:
            marker = terminal.send(data)
        write.assert_called_once_with(123, data)
        self.assertEqual(marker, len(terminal.raw))
        self.assertEqual(bytes.fromhex(terminal.events[-1]['hex']), data)
        self.assertTrue(terminal.events[-1]['completed'])
        self.assertEqual(terminal.events[-1]['bytesWritten'], len(data))

    def test_partial_input_write_is_reported_instead_of_silently_losing_keys(self):
        terminal, clock = self.terminal()
        with patch('installer_terminal.os.name', 'posix'), patch('installer_terminal.os.write', return_value=1):
            with self.assertRaisesRegex(OSError, 'Partial terminal input'):
                terminal.send(b'\x1b[F\r')
        self.assertFalse(terminal.events[-1]['completed'])
        self.assertEqual(terminal.events[-1]['bytesWritten'], 1)


if __name__ == '__main__':
    unittest.main()
