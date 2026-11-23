export interface Glyphs {
  ok: string;
  err: string;
  info: string;
  warn: string;
  spinner: string[];
  barFilled: string;
  barEmpty: string;
  rail: string;
  phaseDone: string;
  dash: string;
  hLine: string;
  treeBranch: string;
  treeLast: string;
  treePipe: string;
}

export const UNICODE_GLYPHS: Glyphs = {
  ok: '✓', err: '✗', info: 'ℹ', warn: '⚠',
  spinner: ['·', '✢', '✳', '✶', '✻', '✽'],
  barFilled: '█', barEmpty: '░', rail: '│', phaseDone: '◆',
  dash: '—', hLine: '─', treeBranch: '├── ', treeLast: '└── ', treePipe: '│   ',
};

export const ASCII_GLYPHS: Glyphs = {
  ok: '[OK]', err: '[ERR]', info: '[i]', warn: '[!]',
  spinner: ['.', '*', '+', 'x', 'o', 'O'],
  barFilled: '#', barEmpty: '-', rail: '|', phaseDone: '*',
  dash: '-', hLine: '-', treeBranch: '|-- ', treeLast: '`-- ', treePipe: '|   ',
};

type OutputPath = 'managed' | 'raw';

function unicodeTerminalMarker(): boolean {
  const env = process.env;
  return [
    env.CI,
    env.WT_SESSION,
    env.TERMINUS_SUBLIME,
    env.ConEmuTask === '{cmd::Cmder}' ? 'cmder' : undefined,
    ['Terminus-Sublime', 'vscode'].includes(env.TERM_PROGRAM ?? '') ? 'program' : undefined,
    ['xterm-256color', 'alacritty'].includes(env.TERM ?? '') ? 'term' : undefined,
    env.TERMINAL_EMULATOR === 'JetBrains-JediTerm' ? 'jetbrains' : undefined,
  ].some(Boolean);
}

function unicodeAllowed(path: OutputPath): boolean {
  if (process.env.AFYX_GRAPH_ASCII === '1') return false;
  if (process.env.AFYX_GRAPH_UNICODE === '1') return true;
  if (process.env.TERM === 'linux') return false;
  if (process.platform !== 'win32') return true;
  return path === 'managed' && unicodeTerminalMarker();
}

export function supportsUnicode(): boolean {
  return unicodeAllowed('managed');
}

export function supportsUnicodeRawWrites(): boolean {
  return unicodeAllowed('raw');
}

let cachedGlyphs: Glyphs | undefined;

export function getGlyphs(): Glyphs {
  cachedGlyphs ??= supportsUnicode() ? UNICODE_GLYPHS : ASCII_GLYPHS;
  return cachedGlyphs;
}

export function getRawWriteGlyphs(): Glyphs {
  return supportsUnicodeRawWrites() ? UNICODE_GLYPHS : ASCII_GLYPHS;
}

/** Test seam for environment matrices; production selection is stable per process. */
export function _resetGlyphsCache(): void {
  cachedGlyphs = undefined;
}
