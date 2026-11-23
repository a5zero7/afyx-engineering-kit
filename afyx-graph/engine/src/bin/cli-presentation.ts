import { getGlyphs } from '../ui/glyphs';
import type { Node } from '../types';

export interface CliColors {
  reset: string;
  bold: string;
  dim: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  cyan: string;
  white: string;
  gray: string;
}

export interface CliChalk {
  bold(value: string): string;
  dim(value: string): string;
  red(value: string): string;
  green(value: string): string;
  yellow(value: string): string;
  blue(value: string): string;
  cyan(value: string): string;
  white(value: string): string;
  gray(value: string): string;
}

export interface CliPresentation {
  colors: CliColors;
  chalk: CliChalk;
  success(message: string): void;
  error(message: string): void;
  info(message: string): void;
  warn(message: string): void;
}

export function createCliPresentation(enabled: boolean): CliPresentation {
  const colors: CliColors = enabled
    ? {
        reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m',
        green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', cyan: '\x1b[36m',
        white: '\x1b[37m', gray: '\x1b[90m',
      }
    : {
        reset: '', bold: '', dim: '', red: '', green: '', yellow: '', blue: '',
        cyan: '', white: '', gray: '',
      };
  const chalk: CliChalk = {
    bold: (value) => `${colors.bold}${value}${colors.reset}`,
    dim: (value) => `${colors.dim}${value}${colors.reset}`,
    red: (value) => `${colors.red}${value}${colors.reset}`,
    green: (value) => `${colors.green}${value}${colors.reset}`,
    yellow: (value) => `${colors.yellow}${value}${colors.reset}`,
    blue: (value) => `${colors.blue}${value}${colors.reset}`,
    cyan: (value) => `${colors.cyan}${value}${colors.reset}`,
    white: (value) => `${colors.white}${value}${colors.reset}`,
    gray: (value) => `${colors.gray}${value}${colors.reset}`,
  };
  return {
    colors,
    chalk,
    success: (message) => console.log(chalk.green(getGlyphs().ok) + ' ' + message),
    error: (message) => console.error(chalk.red(getGlyphs().err) + ' ' + message),
    info: (message) => console.log(chalk.blue(getGlyphs().info) + ' ' + message),
    warn: (message) => console.log(chalk.yellow(getGlyphs().warn) + ' ' + message),
  };
}

export function formatCliNumber(value: number): string {
  return value.toLocaleString();
}

export function formatCliDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds}ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${(seconds % 60).toFixed(0)}s`;
}

export function formatCliSymbolNotFound(symbol: string, fuzzyNames: string[]): string {
  const suggestions = [...new Set(fuzzyNames.filter((name) => name !== symbol))].slice(0, 3);
  if (suggestions.length === 0) return `Symbol "${symbol}" not found`;
  return `Symbol "${symbol}" not found — did you mean: ${suggestions.join(', ')}?`;
}

/** Compact node shape retained by existing CLI JSON lists. */
export function cliNode(node: Node) {
  return { name: node.name, kind: node.kind, filePath: node.filePath, startLine: node.startLine };
}

/** Attribute a group's edges to every overload of this definition. */
export function cliDefinition(group: Node[]) {
  const head = group[0]!;
  return {
    definition: { ...cliNode(head), id: head.id, qualifiedName: head.qualifiedName, language: head.language },
    roots: group.map((node) => node.id),
  };
}
