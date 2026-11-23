import type { Language } from '../types';

export type GuardForm = 'if' | 'else' | 'ternary' | 'case' | 'guard' | 'and' | 'or' | 'catch';
export type GuardExit = 'return' | 'throw' | 'exit';

export interface BranchGuard {
  text: string;
  negated: boolean;
  form: GuardForm;
  line: number;
  branch: string;
  armExit?: GuardExit;
  exit?: GuardExit;
}

export const BRANCH_GUARD_LANGUAGES: readonly Language[] = [
  'typescript', 'tsx', 'javascript', 'jsx', 'arkts', 'swift', 'python', 'java',
  'kotlin', 'csharp', 'go', 'c', 'cpp', 'objc',
];

export function supportsBranchGuards(language: Language | string | undefined | null): boolean {
  return typeof language === 'string' && BRANCH_GUARD_LANGUAGES.includes(language as Language);
}

export function guardLabel(guards: readonly BranchGuard[]): string {
  return guards.map(labelPart).join(' && ');
}

function labelPart(guard: BranchGuard): string {
  if (guard.form === 'catch') return guard.text;
  if (!guard.negated) return topLevelDisjunction(guard.text) ? `(${guard.text})` : guard.text;
  if (/^!(?![=])/.test(guard.text) && simpleOperand(guard.text.slice(1))) return guard.text.slice(1);
  if (/^not\s+/.test(guard.text) && simpleOperand(guard.text.slice(4).trim())) return guard.text.slice(4).trim();
  const inverse = invertComparison(guard.text);
  if (inverse) return inverse;
  return simpleOperand(guard.text) ? `!${guard.text}` : `!(${guard.text})`;
}

function invertComparison(text: string): string | null {
  if (/&&|\|\||\band\b|\bor\b|\?/.test(text) || topLevelDisjunction(text)) return null;
  const match = /^([^=!<>]+?)\s*(===|!==|==|!=|\bis not\b|\bis\b)\s*([^=!<>]+)$/.exec(text);
  if (!match) return null;
  const opposite: Record<string, string> = { '===': '!==', '!==': '===', '==': '!=', '!=': '==', is: 'is not', 'is not': 'is' };
  const operator = opposite[match[2]!];
  return operator ? `${match[1]!.trim()} ${operator} ${match[3]!.trim()}` : null;
}

function topLevelDisjunction(text: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (quote) {
      if (character === '\\') index++;
      else if (character === quote) quote = null;
    } else if (character === "'" || character === '"' || character === '`') quote = character;
    else if ('([{'.includes(character)) depth++;
    else if (')]}'.includes(character)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && character === '|' && text[index + 1] === '|') return true;
  }
  return false;
}

function simpleOperand(text: string): boolean {
  if (/[=<>]/.test(text) || /\s(?:&&|\|\||and|or)\s/.test(text)) return false;
  const match = /^([\w$.?!]+)(\(.*\))?$/s.exec(text);
  if (!match) return false;
  if (!match[2]) return true;
  let depth = 0;
  for (let index = 0; index < match[2].length; index++) {
    if (match[2][index] === '(') depth++;
    else if (match[2][index] === ')' && --depth === 0 && index < match[2].length - 1) return false;
  }
  return depth === 0;
}
