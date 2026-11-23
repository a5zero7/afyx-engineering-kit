export interface AfyxRouteOptions {
  hidden?: boolean;
}

interface CliOption {
  flags: string;
  short?: string;
  long: string;
  key: string;
  description: string;
  takesValue: boolean;
  negative: boolean;
  defaultValue?: string;
}

interface Operand {
  name: string;
  required: boolean;
  variadic: boolean;
}

interface Route {
  signature: string;
  name: string;
  operands: Operand[];
  aliases: string[];
  hidden: boolean;
  description: string;
  options: CliOption[];
  helpAfter?: string;
  handler?: (...args: any[]) => unknown;
}

function optionKey(long: string): string {
  const positive = long.replace(/^--(?:no-)?/, '');
  return positive.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function parseOption(flags: string, description: string, defaultValue?: string): CliOption {
  const parts = flags.split(',').map((part) => part.trim());
  const longPart = parts.find((part) => part.startsWith('--'));
  if (!longPart) throw new Error(`Afyx CLI option requires a long name: ${flags}`);
  const shortPart = parts.find((part) => /^-[^-]/.test(part));
  const long = longPart.split(/[ <[]/, 1)[0]!;
  return {
    flags,
    short: shortPart?.split(/[ <[]/, 1)[0],
    long,
    key: optionKey(long),
    description,
    takesValue: /[<[][^>\]]+[>\]]/.test(flags),
    negative: long.startsWith('--no-'),
    defaultValue,
  };
}

function parseSignature(signature: string): { name: string; operands: Operand[] } {
  const [name, ...parts] = signature.trim().split(/\s+/);
  if (!name) throw new Error('Afyx CLI route name is required');
  return {
    name,
    operands: parts.map((part) => ({
      name: part.replace(/^[<[[]|[>\]]$/g, '').replace(/\.\.\.$/, ''),
      required: part.startsWith('<'),
      variadic: part.includes('...'),
    })),
  };
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
  throw new CliParseStop();
}

class CliParseStop extends Error {}

function wrap(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function formatRows(rows: Array<[string, string]>, totalWidth = 80, sharedTermWidth?: number): string {
  const indent = '  ';
  const gap = '  ';
  const termWidth = sharedTermWidth ?? Math.max(...rows.map(([term]) => term.length));
  const descriptionWidth = Math.max(20, totalWidth - indent.length - termWidth - gap.length);
  const output: string[] = [];
  for (const [term, description] of rows) {
    const lines = wrap(description, descriptionWidth);
    output.push(`${indent}${term.padEnd(termWidth)}${gap}${lines[0] ?? ''}`.trimEnd());
    for (const line of lines.slice(1)) output.push(`${indent}${' '.repeat(termWidth)}${gap}${line}`.trimEnd());
  }
  return output.join('\n');
}

class AfyxRouteBuilder {
  constructor(private readonly owner: AfyxCli, private readonly routeSpec: Route) {}

  alternativeNames(names: string[]): this {
    this.routeSpec.aliases = [...names];
    return this;
  }

  summary(description: string): this {
    this.routeSpec.description = description;
    return this;
  }

  flag(flags: string, description: string, defaultValue?: string): this {
    this.routeSpec.options.push(parseOption(flags, description, defaultValue));
    return this;
  }

  helpText(_position: 'after', text: string): this {
    this.routeSpec.helpAfter = text;
    return this;
  }

  handle(handler: (...args: any[]) => unknown): AfyxCli {
    this.routeSpec.handler = handler;
    return this.owner;
  }
}

/** Afyx-specific parser for the fixed public command catalog. */
export class AfyxCli {
  private productName = 'afyx-graph';
  private productDescription = '';
  private productVersion = '0.0.0';
  private readonly globalOptions: CliOption[] = [];
  private readonly routes: Route[] = [];

  product(name: string): this {
    this.productName = name;
    return this;
  }

  summary(description: string): this {
    this.productDescription = description;
    return this;
  }

  release(version: string): this {
    this.productVersion = version;
    return this;
  }

  flag(flags: string, description: string, defaultValue?: string): this {
    this.globalOptions.push(parseOption(flags, description, defaultValue));
    return this;
  }

  route(signature: string, options: AfyxRouteOptions = {}): AfyxRouteBuilder {
    const parsed = parseSignature(signature);
    const route: Route = {
      signature,
      ...parsed,
      aliases: [],
      hidden: Boolean(options.hidden),
      description: '',
      options: [],
    };
    this.routes.push(route);
    return new AfyxRouteBuilder(this, route);
  }

  catalog(): Array<{ name: string; aliases: string[]; hidden: boolean }> {
    return this.routes.map((route) => ({
      name: route.name,
      aliases: [...route.aliases],
      hidden: route.hidden,
    }));
  }

  private optionTerm(option: CliOption): string {
    return option.flags;
  }

  private optionDescription(option: CliOption): string {
    return option.defaultValue === undefined
      ? option.description
      : `${option.description} (default: "${option.defaultValue}")`;
  }

  private rootHelp(): string {
    const optionRows: Array<[string, string]> = [
      ['-V, --version', 'output the version number'],
      ...this.globalOptions.map((option) => [this.optionTerm(option), this.optionDescription(option)] as [string, string]),
      ['-h, --help', 'display help for command'],
    ];
    const commandRows: Array<[string, string]> = this.routes
      .filter((route) => !route.hidden)
      .map((route) => {
        const names = [route.name, ...route.aliases].join('|');
        const signatureTail = route.signature.slice(route.name.length);
        const options = route.options.length > 0 ? ' [options]' : '';
        return [`${names}${options}${signatureTail}`, route.description];
      });
    commandRows.push(['help [command]', 'display help for command']);
    const sharedTermWidth = Math.max(
      ...optionRows.map(([term]) => term.length),
      ...commandRows.map(([term]) => term.length),
    );
    return [
      `Usage: ${this.productName} [options] [command]`,
      '',
      this.productDescription,
      '',
      'Options:',
      formatRows(optionRows, 80, sharedTermWidth),
      '',
      'Commands:',
      formatRows(commandRows, 80, sharedTermWidth),
      '',
    ].join('\n');
  }

  private routeHelp(route: Route): string {
    const rows: Array<[string, string]> = [
      ...route.options.map((option) => [this.optionTerm(option), this.optionDescription(option)] as [string, string]),
      ['-h, --help', 'display help for command'],
    ];
    const blocks = [
      `Usage: ${this.productName} ${route.name}${route.options.length ? ' [options]' : ''}${route.signature.slice(route.name.length)}`,
      '',
      route.description,
      '',
      'Options:',
      formatRows(rows),
    ];
    if (route.helpAfter) blocks.push('', route.helpAfter.replace(/^\n|\n$/g, ''));
    blocks.push('');
    return blocks.join('\n');
  }

  private findOption(route: Route, token: string): CliOption | undefined {
    const name = token.split('=', 1)[0]!;
    return route.options.find((option) => option.long === name || option.short === name);
  }

  private dispatch(route: Route, tokens: string[]): void {
    const values: Record<string, unknown> = {};
    for (const option of route.options) {
      if (option.defaultValue !== undefined) values[option.key] = option.defaultValue;
      if (option.negative) values[option.key] = true;
    }
    const positionals: string[] = [];
    let optionsEnded = false;
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]!;
      if (!optionsEnded && token === '--') {
        optionsEnded = true;
        continue;
      }
      if (!optionsEnded && (token === '--help' || token === '-h')) {
        process.stdout.write(this.routeHelp(route));
        return;
      }
      if (!optionsEnded && token.startsWith('-')) {
        const option = this.findOption(route, token);
        if (!option) fail(`unknown option '${token.split('=', 1)[0]}'`);
        if (option.takesValue) {
          const inline = token.includes('=') ? token.slice(token.indexOf('=') + 1) : undefined;
          const next = inline ?? tokens[++index];
          if (next === undefined || (!inline && next.startsWith('-'))) {
            fail(`option '${option.long}' argument missing`);
          }
          values[option.key] = next;
        } else {
          if (token.includes('=')) fail(`option '${option.long}' does not take a value`);
          values[option.key] = !option.negative;
        }
      } else {
        positionals.push(token);
      }
    }

    const actionArgs: unknown[] = [];
    let offset = 0;
    for (const operand of route.operands) {
      if (operand.variadic) {
        const rest = positionals.slice(offset);
        if (operand.required && rest.length === 0) fail(`missing required argument '${operand.name}'`);
        actionArgs.push(rest);
        offset = positionals.length;
      } else {
        const value = positionals[offset++];
        if (operand.required && value === undefined) fail(`missing required argument '${operand.name}'`);
        actionArgs.push(value);
      }
    }
    if (offset < positionals.length) fail(`too many arguments for '${route.name}'`);
    actionArgs.push(values);
    if (!route.handler) throw new Error(`Afyx CLI route has no handler: ${route.name}`);
    void Promise.resolve(route.handler(...actionArgs)).catch((error) => {
      queueMicrotask(() => { throw error; });
    });
  }

  execute(argv: readonly string[] = process.argv): void {
    try {
      const tokens = [...argv.slice(2)];
      const first = tokens[0];
      if (first === '--version' || first === '-V') {
        process.stdout.write(`${this.productVersion}\n`);
        return;
      }
      if (!first || first === '--help' || first === '-h') {
        process.stdout.write(this.rootHelp());
        return;
      }
      if (first === 'help') {
        const target = tokens[1];
        if (!target) {
          process.stdout.write(this.rootHelp());
          return;
        }
        const route = this.routes.find((candidate) => candidate.name === target || candidate.aliases.includes(target));
        if (!route) fail(`unknown command '${target}'`);
        process.stdout.write(this.routeHelp(route));
        return;
      }
      const route = this.routes.find((candidate) => candidate.name === first || candidate.aliases.includes(first));
      if (!route) fail(`unknown command '${first}'`);
      this.dispatch(route, tokens.slice(1));
    } catch (error) {
      if (!(error instanceof CliParseStop)) throw error;
    }
  }
}
