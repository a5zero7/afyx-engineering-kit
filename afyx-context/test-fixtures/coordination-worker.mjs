import fs from 'node:fs';
import { AfyxContextEngine } from '../src/engine.js';
import { ContextStore } from '../src/storage.js';

const sleeper = new Int32Array(new SharedArrayBuffer(4));
const [mode, stateDir, ownerId, sessionId, readyPath, gatePath, outputPath, payload = '', id = 'worker', timeout = '5000'] = process.argv.slice(2);

function waitForGate() {
  fs.writeFileSync(readyPath, `${process.pid}\n`, { flag: 'wx' });
  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(gatePath)) {
    if (Date.now() >= deadline) throw new Error('coordination fixture gate timed out');
    Atomics.wait(sleeper, 0, 0, 10);
  }
}

try {
  if (mode === 'hold') {
    const store = new ContextStore({ stateDir, ownerId, sessionId, lockTimeoutMs: Number(timeout) });
    store.withExclusiveAccess(() => {
      waitForGate();
      Atomics.wait(sleeper, 0, 0, 30_000);
    });
  } else if (mode === 'interrupt-write') {
    const engine = new AfyxContextEngine({ stateDir, ownerId, sessionId, lockTimeoutMs: Number(timeout) });
    const renameSync = fs.renameSync;
    fs.renameSync = (source, destination) => {
      if (destination === engine.store.sessionPath) {
        fs.writeFileSync(readyPath, `${process.pid}\n`, { flag: 'wx' });
        Atomics.wait(sleeper, 0, 0, 30_000);
      }
      return renameSync(source, destination);
    };
    engine.reduce({ segments: [{ id, content: payload }] });
  } else if (mode === 'reduce') {
    waitForGate();
    const engine = new AfyxContextEngine({ stateDir, ownerId, sessionId, lockTimeoutMs: Number(timeout) });
    const result = engine.reduce({ segments: [{ id, content: payload }] });
    fs.writeFileSync(outputPath, JSON.stringify({ ok: true, result }), { flag: 'wx' });
  } else {
    throw new Error(`unknown coordination fixture mode: ${mode}`);
  }
} catch (error) {
  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify({
      ok: false,
      code: error?.code ?? 'INTERNAL',
      message: error?.message ?? String(error),
    }), { flag: 'wx' });
  }
  process.exitCode = 2;
}
