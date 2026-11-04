import fs from 'node:fs';
import path from 'node:path';
import { AfyxContextEngine } from './engine.js';
import { createOptionalIntegrationAdapter } from './integrations.js';

if (typeof process.send !== 'function') throw new Error('Graph–ACE integration worker requires an IPC parent');

const checkpointSleeper = new Int32Array(new SharedArrayBuffer(4));

function installTestCheckpoint(control) {
  if (control === undefined) return () => {};
  if (!control || typeof control !== 'object'
    || !['after-lock-acquired', 'before-session-commit', 'after-session-commit'].includes(control.phase)
    || typeof control.readyPath !== 'string' || !control.readyPath) {
    throw new Error('invalid native-worker test checkpoint');
  }
  const renameSync = fs.renameSync;
  fs.renameSync = (source, destination) => {
    const lockCommit = control.phase === 'after-lock-acquired'
      && path.basename(destination) === 'owner.json'
      && path.basename(path.dirname(destination)) === '.ace-lock';
    const sessionCommit = path.basename(destination) === 'session.json';
    const before = control.phase === 'before-session-commit' && sessionCommit;
    const after = (control.phase === 'after-session-commit' && sessionCommit) || lockCommit;
    if (before) {
      fs.writeFileSync(control.readyPath, `${process.pid}\n`, { flag: 'wx' });
      Atomics.wait(checkpointSleeper, 0, 0);
    }
    const result = renameSync(source, destination);
    if (after) {
      fs.writeFileSync(control.readyPath, `${process.pid}\n`, { flag: 'wx' });
      Atomics.wait(checkpointSleeper, 0, 0);
    }
    return result;
  };
  return () => { fs.renameSync = renameSync; };
}

function reply(value) {
  process.send(value, () => process.disconnect());
}

process.once('message', (message) => {
  const restore = installTestCheckpoint(message?.testControl);
  try {
    if (message?.operation === 'reduce') {
      const adapter = createOptionalIntegrationAdapter({ component: 'graph' });
      reply(adapter.process(message.request));
      return;
    }
    if (message?.operation === 'retrieve') {
      const engine = new AfyxContextEngine({
        stateDir: message.stateDir,
        ownerId: message.ownerId,
        sessionId: message.sessionId,
      });
      reply({ status: 'recovered', record: engine.retrieveRecord(message.reference) });
      return;
    }
    reply({ status: 'error', failureCode: 'INVALID_INTEGRATION', message: 'unknown worker operation' });
  } catch (error) {
    reply({
      status: 'error',
      failureCode: typeof error?.code === 'string' ? error.code : 'ACE_UNAVAILABLE',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    restore();
  }
});
