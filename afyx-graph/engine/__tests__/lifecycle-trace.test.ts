import { afterEach, describe, expect, it, vi } from 'vitest';
import { lifecycleTrace } from '../src/mcp/lifecycle-trace';

const originalTrace = process.env.AFYX_GRAPH_LIFECYCLE_TRACE;

afterEach(() => {
  if (originalTrace === undefined) delete process.env.AFYX_GRAPH_LIFECYCLE_TRACE;
  else process.env.AFYX_GRAPH_LIFECYCLE_TRACE = originalTrace;
  vi.restoreAllMocks();
});

describe('payload-free lifecycle trace', () => {
  it('is silent unless explicitly enabled', () => {
    delete process.env.AFYX_GRAPH_LIFECYCLE_TRACE;
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    lifecycleTrace('client_registered', { sessionId: 'session-1', activeClients: 1 });
    expect(write).not.toHaveBeenCalled();
  });

  it('emits one structured identity/state event when enabled', () => {
    process.env.AFYX_GRAPH_LIFECYCLE_TRACE = '1';
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    lifecycleTrace('client_registered', { sessionId: 'session-1', activeClients: 2 });

    expect(write).toHaveBeenCalledTimes(1);
    const line = String(write.mock.calls[0][0]);
    expect(line.startsWith('[afyx-graph-lifecycle] ')).toBe(true);
    const record = JSON.parse(line.slice('[afyx-graph-lifecycle] '.length));
    expect(record).toMatchObject({
      event: 'client_registered',
      pid: process.pid,
      ppid: process.ppid,
      sessionId: 'session-1',
      activeClients: 2,
    });
    expect(typeof record.monotonicMs).toBe('number');
  });
});
