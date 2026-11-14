import { performance } from 'node:perf_hooks';

export const INSTALL_PROGRESS_CONTRACT = 'AfyxInstallerProgress/v1';
export const INSTALL_PROGRESS_PREFIX = 'AFYX_PROGRESS ';
const phases = new Set(['discovery', 'validation', 'planning', 'revalidation', 'download', 'extract', 'install',
  'update', 'repair', 'configure', 'verify', 'cleanup', 'rollback', 'receipt']);
const states = new Set(['queued', 'running', 'completed', 'failed', 'cancelled']);

export function progressEvent(input) {
  const event = { contract: INSTALL_PROGRESS_CONTRACT, operationId: input.operationId,
    componentId: input.componentId ?? null, phase: input.phase, state: input.state,
    completed: input.completed ?? null, total: input.total ?? null,
    message: input.message ?? '', timestamp: input.timestamp ?? new Date().toISOString(), errorCode: input.errorCode ?? null };
  if ((input.contract && input.contract !== INSTALL_PROGRESS_CONTRACT)
    || typeof event.operationId !== 'string' || !/^[\w.:/-]{1,128}$/.test(event.operationId)
    || (event.componentId !== null && (typeof event.componentId !== 'string' || !/^[a-z][a-z0-9-]{1,79}$/.test(event.componentId)))
    || !phases.has(event.phase) || !states.has(event.state)
    || typeof event.message !== 'string' || event.message.length > 8192
    || typeof event.timestamp !== 'string' || !Number.isFinite(Date.parse(event.timestamp))
    || (event.errorCode !== null && (typeof event.errorCode !== 'string' || event.errorCode.length > 128))) {
    throw new Error('Invalid installer progress event');
  }
  if (event.completed !== null || event.total !== null) {
    if (!Number.isSafeInteger(event.completed) || !Number.isSafeInteger(event.total)
      || event.completed < 0 || event.total <= 0 || event.completed > event.total) throw new Error('Invalid installer progress units');
    if (event.state === 'completed' && event.completed !== event.total) throw new Error('Completed progress must account for all units');
  }
  return Object.freeze(event);
}

export function elapsedLabel(milliseconds) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export class InstallerProgress {
  constructor({ clock = () => performance.now(), reducedMotion = false } = {}) {
    this.clock = clock; this.reducedMotion = reducedMotion; this.started = clock();
    this.operations = new Map(); this.activity = []; this.sequence = 0;
  }
  accept(input) {
    const event = progressEvent(input);
    const previous = this.operations.get(event.operationId);
    if (previous && ['completed', 'failed', 'cancelled'].includes(previous.state)) return previous;
    if (!previous && this.operations.size >= 128) this.operations.delete(this.operations.keys().next().value);
    const observed = { ...event, started: previous?.state === 'queued' && event.state === 'running' ? this.clock() : previous?.started ?? this.clock() };
    this.operations.set(event.operationId, observed);
    this.activity.push(`[${elapsedLabel(this.clock() - this.started)}] ${event.state.toUpperCase()} ${event.message}`);
    if (this.activity.length > 64) this.activity.shift();
    return observed;
  }
  begin(phase, message, componentId = null) {
    const operationId = `ui:${phase}:${++this.sequence}`;
    this.accept({ operationId, componentId, phase, state: 'running', message });
    return operationId;
  }
  end(operationId, state = 'completed', message) {
    const previous = this.operations.get(operationId);
    if (previous) this.accept({ ...previous, state, message: message ?? previous.message });
  }
  stop(state) {
    for (const operation of this.operations.values()) {
      if (operation.state === 'running' || operation.state === 'queued') this.end(operation.operationId, operation.state === 'queued' ? 'cancelled' : state);
    }
  }
  lines() {
    const latest = new Map();
    for (const operation of this.operations.values()) if (operation.componentId) latest.set(operation.componentId, operation);
    return [...latest.values()].map((operation) =>
      `${operation.componentId}: ${this.describe(operation)}`);
  }
  describe(operation) {
    const elapsed = this.clock() - operation.started;
    if (operation.total !== null) {
      const percent = Math.floor(100 * operation.completed / operation.total);
      const filled = Math.floor(12 * operation.completed / operation.total);
      return `[${'='.repeat(filled)}${'-'.repeat(12 - filled)}] ${percent}% ${operation.completed}/${operation.total} ${operation.state.toUpperCase()}`;
    }
    if (operation.state !== 'running') return operation.state.toUpperCase();
    const position = this.reducedMotion ? 0 : Math.floor(elapsed / 80) % 10;
    const rail = `${'-'.repeat(position)}>`.padEnd(10, '-');
    return `[${rail}] INDETERMINATE ${elapsedLabel(elapsed)}`;
  }
  current() {
    const active = [...this.operations.values()].filter((operation) => operation.state === 'running').at(-1);
    return active ? `${active.message} ${this.describe(active)}` : 'Waiting for the next confirmed operation';
  }
}
