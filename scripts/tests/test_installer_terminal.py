"""Protect terminal capture accuracy without starting a host process."""
import contextlib
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


if __name__ == '__main__':
    unittest.main()
