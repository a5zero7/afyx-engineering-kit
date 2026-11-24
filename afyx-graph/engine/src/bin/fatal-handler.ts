import { writeSync } from 'node:fs';

export interface FatalHandlerDeps {
  target?: NodeJS.EventEmitter;
  exit?: (code: number) => void;
  write?: (line: string) => void;
}

export function describeFatal(value: unknown): string {
  if (value instanceof Error) {
    const errName = typeof value.name === 'string' && value.name.length > 0 ? value.name : 'Error';
    const errMsg = typeof value.message === 'string' ? value.message : '';
    return errMsg.length > 0 ? `${errName}: ${errMsg}` : errName;
  }
  try {
    return String(value);
  } catch {
    return '<unstringifiable value>';
  }
}

function writeStderrSync(line: string): void {
  try {
    writeSync(2, line);
  } catch {
    // Ignore closed stderr during process teardown.
  }
}

export function installFatalHandlers(deps: FatalHandlerDeps = {}): void {
  const emitter = deps.target ?? process;
  const terminate = deps.exit ?? ((code: number) => process.exit(code));
  const emitLine = deps.write ?? writeStderrSync;

  const handleFatal = (label: string, payload: unknown): void => {
    emitLine(`[Afyx Graph] ${label}: ${describeFatal(payload)}\n`);
    terminate(1);
  };

  emitter.on('uncaughtException', (error: unknown) => handleFatal('Uncaught exception', error));
  emitter.on('unhandledRejection', (reason: unknown) => handleFatal('Unhandled rejection', reason));
}
