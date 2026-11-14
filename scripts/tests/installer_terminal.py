"""Disposable native PTY/ConPTY driver. Standard library only; never edits a host profile."""
from __future__ import annotations

import codecs
import ctypes
import os
import queue
import re
import signal
import struct
import subprocess
import threading
import time
from pathlib import Path


class TerminalProcess:
    def __init__(self, argv, cwd, env, columns=120, rows=35):
        self.columns, self.rows = columns, rows
        self.raw = bytearray()
        self.output = queue.Queue()
        self.cells = [[" "] * columns for _ in range(rows)]
        self.row = self.column = 0
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self.pending = ""
        self.closed = False
        if os.name == "nt":
            self._windows(argv, cwd, env)
        else:
            import fcntl
            import pty
            import termios
            self.master, slave = pty.openpty()
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
            def child_terminal():
                os.setsid()
                fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
            self.process = subprocess.Popen(argv, cwd=cwd, env=env, stdin=slave, stdout=slave,
                                            stderr=slave, preexec_fn=child_terminal)
            os.close(slave)
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _windows(self, argv, cwd, env):
        from ctypes import wintypes as w
        self.kernel = k = ctypes.WinDLL("kernel32", use_last_error=True)
        class Coord(ctypes.Structure):
            _fields_ = [("X", ctypes.c_short), ("Y", ctypes.c_short)]
        class Startup(ctypes.Structure):
            _fields_ = [("cb", w.DWORD), ("reserved", w.LPWSTR), ("desktop", w.LPWSTR), ("title", w.LPWSTR),
                        ("x", w.DWORD), ("y", w.DWORD), ("cx", w.DWORD), ("cy", w.DWORD),
                        ("charsx", w.DWORD), ("charsy", w.DWORD), ("fill", w.DWORD), ("flags", w.DWORD),
                        ("show", w.WORD), ("reserved2", w.WORD), ("bytes", ctypes.POINTER(ctypes.c_byte)),
                        ("stdin", w.HANDLE), ("stdout", w.HANDLE), ("stderr", w.HANDLE)]
        class StartupEx(ctypes.Structure):
            _fields_ = [("startup", Startup), ("attributes", ctypes.c_void_p)]
        class Process(ctypes.Structure):
            _fields_ = [("process", w.HANDLE), ("thread", w.HANDLE), ("pid", w.DWORD), ("tid", w.DWORD)]
        class Limits(ctypes.Structure):
            _fields_ = [("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong), ("flags", w.DWORD),
                        ("minimum", ctypes.c_size_t), ("maximum", ctypes.c_size_t), ("active", w.DWORD),
                        ("affinity", ctypes.c_size_t), ("priority", w.DWORD), ("scheduling", w.DWORD)]
        class Io(ctypes.Structure):
            _fields_ = [(f"counter{i}", ctypes.c_ulonglong) for i in range(6)]
        class ExtendedLimits(ctypes.Structure):
            _fields_ = [("basic", Limits), ("io", Io), ("process_memory", ctypes.c_size_t),
                        ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]
        k.CreatePipe.argtypes = [ctypes.POINTER(w.HANDLE), ctypes.POINTER(w.HANDLE), ctypes.c_void_p, w.DWORD]
        k.CreatePipe.restype = w.BOOL
        k.CreatePseudoConsole.argtypes = [Coord, w.HANDLE, w.HANDLE, w.DWORD, ctypes.POINTER(w.HANDLE)]
        k.CreatePseudoConsole.restype = ctypes.c_long
        k.InitializeProcThreadAttributeList.argtypes = [ctypes.c_void_p, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.c_size_t)]
        k.UpdateProcThreadAttribute.argtypes = [ctypes.c_void_p, w.DWORD, ctypes.c_size_t, ctypes.c_void_p,
                                               ctypes.c_size_t, ctypes.c_void_p, ctypes.c_void_p]
        k.CreateProcessW.argtypes = [w.LPCWSTR, w.LPWSTR, ctypes.c_void_p, ctypes.c_void_p, w.BOOL, w.DWORD,
                                    ctypes.c_void_p, w.LPCWSTR, ctypes.POINTER(StartupEx), ctypes.POINTER(Process)]
        k.CreateProcessW.restype = w.BOOL
        k.ReadFile.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD, ctypes.POINTER(w.DWORD), ctypes.c_void_p]
        k.WriteFile.argtypes = [w.HANDLE, ctypes.c_void_p, w.DWORD, ctypes.POINTER(w.DWORD), ctypes.c_void_p]
        k.GetExitCodeProcess.argtypes = [w.HANDLE, ctypes.POINTER(w.DWORD)]
        k.TerminateProcess.argtypes = [w.HANDLE, w.UINT]
        k.CloseHandle.argtypes = [w.HANDLE]
        k.ClosePseudoConsole.argtypes = [w.HANDLE]
        k.ResizePseudoConsole.argtypes = [w.HANDLE, Coord]
        k.DeleteProcThreadAttributeList.argtypes = [ctypes.c_void_p]
        k.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        k.CreateJobObjectW.restype = w.HANDLE
        k.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        k.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        k.ResumeThread.argtypes = [w.HANDLE]
        k.GetStdHandle.argtypes = [w.DWORD]; k.GetStdHandle.restype = w.HANDLE
        k.SetStdHandle.argtypes = [w.DWORD, w.HANDLE]
        self.Coord = Coord
        incoming, self.writer = w.HANDLE(), w.HANDLE()
        self.receiver, outgoing = w.HANDLE(), w.HANDLE()
        if not k.CreatePipe(ctypes.byref(incoming), ctypes.byref(self.writer), None, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        if not k.CreatePipe(ctypes.byref(self.receiver), ctypes.byref(outgoing), None, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        self.console = w.HANDLE()
        result = k.CreatePseudoConsole(Coord(self.columns, self.rows), incoming, outgoing, 0, ctypes.byref(self.console))
        if result != 0:
            raise OSError(f"CreatePseudoConsole HRESULT={result:#x}")
        size = ctypes.c_size_t()
        k.InitializeProcThreadAttributeList(None, 1, 0, ctypes.byref(size))
        self.attribute_memory = ctypes.create_string_buffer(size.value)
        if not k.InitializeProcThreadAttributeList(self.attribute_memory, 1, 0, ctypes.byref(size)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not k.UpdateProcThreadAttribute(self.attribute_memory, 0, 0x00020016, self.console,
                                           ctypes.sizeof(w.HANDLE), None, None):
            raise ctypes.WinError(ctypes.get_last_error())
        startup = StartupEx(); startup.startup.cb = ctypes.sizeof(startup)
        startup.attributes = ctypes.cast(self.attribute_memory, ctypes.c_void_p)
        self.info = Process()
        self.job = k.CreateJobObjectW(None, None)
        limits = ExtendedLimits(); limits.basic.flags = 0x2000  # Kill only this disposable process tree on job close.
        if not self.job or not k.SetInformationJobObject(self.job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise ctypes.WinError(ctypes.get_last_error())
        block = ctypes.create_unicode_buffer("\0".join(f"{name}={value}" for name, value in sorted(env.items(), key=lambda x: x[0].upper())) + "\0\0")
        command = ctypes.create_unicode_buffer(subprocess.list2cmdline([str(x) for x in argv]))
        # A test runner's redirected standard handles must not leak into the
        # hosted console child. NULL lets console attachment create its own
        # CONIN$/CONOUT$ handles. Restore this private helper immediately.
        standard = [(value, k.GetStdHandle(value)) for value in [0xFFFFFFF6, 0xFFFFFFF5, 0xFFFFFFF4]]
        try:
            for value, _ in standard: k.SetStdHandle(value, None)
            created = k.CreateProcessW(str(argv[0]), command, None, None, False, 0x00080000 | 0x00000400 | 0x00000004,
                                       block, str(cwd), ctypes.byref(startup), ctypes.byref(self.info))
        finally:
            for value, handle in standard: k.SetStdHandle(value, handle)
        if not created: raise ctypes.WinError(ctypes.get_last_error())
        if not k.AssignProcessToJobObject(self.job, self.info.process):
            k.TerminateProcess(self.info.process, 1)
            raise ctypes.WinError(ctypes.get_last_error())
        k.ResumeThread(self.info.thread)
        k.CloseHandle(incoming); k.CloseHandle(outgoing); k.CloseHandle(self.info.thread)

    def _read(self):
        try:
            while not self.closed:
                if os.name == "nt":
                    from ctypes import wintypes as w
                    buffer = ctypes.create_string_buffer(16_384); count = w.DWORD()
                    if not self.kernel.ReadFile(self.receiver, buffer, len(buffer), ctypes.byref(count), None) or not count.value:
                        break
                    data = buffer.raw[:count.value]
                else:
                    data = os.read(self.master, 16_384)
                    if not data:
                        break
                self.output.put(data)
                if b"\x1b[6n" in data:
                    self.send(b"\x1b[1;1R")
        except OSError:
            pass

    def send(self, data):
        if isinstance(data, str):
            data = data.encode("utf-8")
        if os.name == "nt":
            from ctypes import wintypes as w
            count = w.DWORD()
            buffer = ctypes.create_string_buffer(data)
            if not self.kernel.WriteFile(self.writer, buffer, len(data), ctypes.byref(count), None):
                raise ctypes.WinError(ctypes.get_last_error())
        else:
            os.write(self.master, data)

    def resize(self, columns, rows):
        if os.name == "nt":
            if self.kernel.ResizePseudoConsole(self.console, self.Coord(columns, rows)) != 0:
                raise OSError("ResizePseudoConsole failed")
        else:
            import fcntl
            import termios
            fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
        self.columns, self.rows = columns, rows
        self.cells = [line[:columns] + [" "] * max(0, columns - len(line)) for line in self.cells[:rows]]
        self.cells.extend([[" "] * columns for _ in range(rows - len(self.cells))])
        self.row, self.column = min(self.row, rows - 1), min(self.column, columns - 1)

    def poll(self):
        if os.name != "nt":
            return self.process.poll()
        from ctypes import wintypes as w
        code = w.DWORD()
        if not self.kernel.GetExitCodeProcess(self.info.process, ctypes.byref(code)):
            raise ctypes.WinError(ctypes.get_last_error())
        return None if code.value == 259 else code.value

    def pump(self, timeout=0.1):
        try:
            data = self.output.get(timeout=timeout)
        except queue.Empty:
            return
        self.raw.extend(data)
        if len(self.raw) > 32 * 1024 * 1024:
            raise RuntimeError("Terminal evidence exceeded 32 MiB")
        self._screen(self.decoder.decode(data))

    def _screen(self, text):
        text = self.pending + text; self.pending = ""; index = 0
        while index < len(text):
            char = text[index]
            if char == "\x1b":
                match = re.match(r"\x1b\[([0-9;?]*)([ -/]*)([@-~])", text[index:])
                if match:
                    args, _, code = match.groups()
                    values = [int(x or 0) for x in args.lstrip("?").split(";")]
                    if code in "Hf": self.row, self.column = (values[0] or 1) - 1, (values[1] if len(values) > 1 and values[1] else 1) - 1
                    elif code == "J":
                        if values[0] == 2: self.cells = [[" "] * self.columns for _ in range(self.rows)]
                        elif values[0] == 0:
                            for row in range(max(0, self.row), self.rows):
                                for col in range(self.column if row == self.row else 0, self.columns): self.cells[row][col] = " "
                    elif code == "K" and self.row < self.rows:
                        start = 0 if values[0] == 2 else self.column
                        for col in range(max(0, start), self.columns): self.cells[max(0, self.row)][col] = " "
                    index += len(match.group()); continue
                osc = re.match(r"\x1b\].*?(?:\x07|\x1b\\)", text[index:], re.S)
                if osc: index += len(osc.group()); continue
                if len(text) - index < 128: self.pending = text[index:]; break
                index += 1; continue
            if char == "\r": self.column = 0
            elif char == "\n": self.row += 1
            elif char == "\b": self.column = max(0, self.column - 1)
            elif char >= " ":
                if self.column >= self.columns: self.column = 0; self.row += 1
                if 0 <= self.row < self.rows: self.cells[self.row][self.column] = char
                self.column += 1
            if self.row >= self.rows:
                self.cells.pop(0); self.cells.append([" "] * self.columns); self.row = self.rows - 1
            index += 1

    def screen(self):
        return "\n".join("".join(row).rstrip() for row in self.cells)

    def wait_for(self, token, timeout=120, reject=(), history=False):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.pump()
            observed = self.raw.decode("utf-8", "replace") if history else self.screen()
            if token in observed: return self.screen()
            for failure in reject:
                if failure in observed:
                    raise RuntimeError(f"Terminal reported {failure!r} before {token!r}:\n{self.screen()}")
            if self.poll() is not None:
                for _ in range(5): self.pump(0.02)
                raise RuntimeError(f"Process exited {self.poll()} before {token!r}:\n{self.screen()}")
        raise TimeoutError(f"Waiting for {token!r}:\n{self.screen()}")

    def save(self, path):
        Path(path).write_bytes(self.raw)

    def close(self):
        if self.closed: return
        if self.poll() is None:
            self.send(b"\x03")
            deadline = time.monotonic() + 5
            while self.poll() is None and time.monotonic() < deadline: self.pump()
            if self.poll() is None:
                if os.name == "nt": self.kernel.TerminateProcess(self.info.process, 1)
                else: os.killpg(self.process.pid, signal.SIGTERM)
        if os.name == "nt":
            self.kernel.CloseHandle(self.job)
            self.kernel.ClosePseudoConsole(self.console)
            for handle in [self.writer, self.receiver, self.info.process]: self.kernel.CloseHandle(handle)
            self.kernel.DeleteProcThreadAttributeList(self.attribute_memory)
        else:
            os.close(self.master)
        self.closed = True
