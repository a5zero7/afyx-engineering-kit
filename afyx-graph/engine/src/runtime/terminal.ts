import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';

export const TERMINAL_CANCEL = Symbol('afyx-terminal-cancel');

interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

interface SelectOptions<T> {
  message: string;
  options: readonly Choice<T>[];
  initialValue?: T;
}

interface MultiSelectOptions<T> {
  message: string;
  options: readonly Choice<T>[];
  initialValues?: readonly T[];
  required?: boolean;
}

interface ConfirmOptions {
  message: string;
  initialValue?: boolean;
}

export interface AfyxTerminal {
  intro(message: string): void;
  outro(message: string): void;
  cancel(message: string): void;
  note(message: string, title?: string): void;
  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
    success(message: string): void;
  };
  select<T>(options: SelectOptions<T>): Promise<T | typeof TERMINAL_CANCEL>;
  multiselect<T>(options: MultiSelectOptions<T>): Promise<T[] | typeof TERMINAL_CANCEL>;
  confirm(options: ConfirmOptions): Promise<boolean | typeof TERMINAL_CANCEL>;
  isCancel(value: unknown): value is typeof TERMINAL_CANCEL;
}

function write(message: string): void {
  stdout.write(`${message}\n`);
}

function canPrompt(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

async function ask(question: string): Promise<string | typeof TERMINAL_CANCEL> {
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    return (await reader.question(question)).trim();
  } catch {
    return TERMINAL_CANCEL;
  } finally {
    reader.close();
  }
}

function showChoices<T>(options: readonly Choice<T>[], selected: ReadonlySet<number>): void {
  options.forEach((option, index) => {
    const marker = selected.has(index) ? '*' : ' ';
    write(`  ${index + 1}. [${marker}] ${option.label}${option.hint ? ` — ${option.hint}` : ''}`);
  });
}

export const afyxTerminal: AfyxTerminal = {
  intro: write,
  outro: write,
  cancel: write,
  note(message, title) {
    if (title) write(`${title}:`);
    for (const line of message.split(/\r?\n/)) write(`  ${line}`);
  },
  log: {
    info: write,
    warn(message) { write(`Warning: ${message}`); },
    error(message) { write(`Error: ${message}`); },
    success: write,
  },
  async select<T>(options: SelectOptions<T>): Promise<T | typeof TERMINAL_CANCEL> {
    const fallback = options.initialValue ?? options.options[0]?.value;
    if (!canPrompt()) return fallback ?? TERMINAL_CANCEL;
    write(options.message);
    const selectedIndex = Math.max(0, options.options.findIndex((choice) => choice.value === fallback));
    showChoices(options.options, new Set([selectedIndex]));
    const answer = await ask(`Choose [${selectedIndex + 1}]: `);
    if (answer === TERMINAL_CANCEL) return answer;
    if (!answer) return fallback ?? TERMINAL_CANCEL;
    const index = Number(answer) - 1;
    return Number.isInteger(index) && index >= 0 && index < options.options.length
      ? options.options[index]!.value
      : fallback ?? TERMINAL_CANCEL;
  },
  async multiselect<T>(options: MultiSelectOptions<T>): Promise<T[] | typeof TERMINAL_CANCEL> {
    const initial = [...(options.initialValues ?? [])];
    // A bare interactive entrypoint invoked through redirected/non-TTY input
    // must remain side-effect free. Scripted installs use --yes/explicit flags
    // and bypass this prompt entirely.
    if (!canPrompt()) return [];
    write(options.message);
    const selected = new Set<number>();
    options.options.forEach((choice, index) => {
      if (initial.includes(choice.value)) selected.add(index);
    });
    showChoices(options.options, selected);
    const defaults = [...selected].map((index) => index + 1).join(',');
    const answer = await ask(`Choose comma-separated numbers [${defaults}]: `);
    if (answer === TERMINAL_CANCEL) return answer;
    if (!answer) return initial;
    const indexes = answer.split(',').map((part) => Number(part.trim()) - 1);
    const valid = [...new Set(indexes)]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < options.options.length);
    if (options.required && valid.length === 0) return initial;
    return valid.map((index) => options.options[index]!.value);
  },
  async confirm(options: ConfirmOptions): Promise<boolean | typeof TERMINAL_CANCEL> {
    const fallback = options.initialValue ?? false;
    if (!canPrompt()) return fallback;
    const answer = await ask(`${options.message} [${fallback ? 'Y/n' : 'y/N'}] `);
    if (answer === TERMINAL_CANCEL) return answer;
    if (!answer) return fallback;
    if (/^(?:y|yes)$/i.test(answer)) return true;
    if (/^(?:n|no)$/i.test(answer)) return false;
    return fallback;
  },
  isCancel(value: unknown): value is typeof TERMINAL_CANCEL {
    return value === TERMINAL_CANCEL;
  },
};
