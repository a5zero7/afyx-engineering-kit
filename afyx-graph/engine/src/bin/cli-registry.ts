import type { AfyxCli, AfyxRouteOptions } from './cli-parser';

export interface CliCommandDefinition {
  name: string;
  aliases: readonly string[];
  hidden: boolean;
}

const DEFINITIONS = [
  { name: 'init', aliases: [], hidden: false },
  { name: 'uninit', aliases: [], hidden: false },
  { name: 'index', aliases: [], hidden: false },
  { name: 'sync', aliases: [], hidden: false },
  { name: 'status', aliases: [], hidden: false },
  { name: 'query', aliases: [], hidden: false },
  { name: 'inventory', aliases: [], hidden: false },
  { name: 'explore', aliases: [], hidden: false },
  { name: 'context', aliases: [], hidden: false },
  { name: 'prompt-hook', aliases: [], hidden: true },
  { name: 'node', aliases: [], hidden: false },
  { name: 'files', aliases: [], hidden: false },
  { name: 'daemon', aliases: ['daemons'], hidden: false },
  { name: 'ui', aliases: ['web'], hidden: false },
  { name: 'serve', aliases: [], hidden: true },
  { name: 'unlock', aliases: [], hidden: false },
  { name: 'callers', aliases: [], hidden: false },
  { name: 'callees', aliases: [], hidden: false },
  { name: 'impact', aliases: [], hidden: false },
  { name: 'affected', aliases: [], hidden: false },
  { name: 'install', aliases: [], hidden: false },
  { name: 'uninstall', aliases: [], hidden: false },
  { name: 'upgrade', aliases: [], hidden: false },
  { name: 'version', aliases: [], hidden: false },
] as const satisfies readonly CliCommandDefinition[];

export type CliCommandName = typeof DEFINITIONS[number]['name'];

const BY_NAME = new Map<CliCommandName, CliCommandDefinition>(
  DEFINITIONS.map((definition) => [definition.name, definition]),
);

/** Canonical command order. Afyx CLI preserves this order in root help. */
export const CLI_COMMANDS: readonly CliCommandDefinition[] = Object.freeze(DEFINITIONS);

/** Build a Afyx CLI signature from a registered public route. */
export function cliCommand(name: CliCommandName, operands = ''): string {
  return operands ? `${name} ${operands}` : name;
}

export function cliAliases(name: CliCommandName): readonly string[] {
  return BY_NAME.get(name)?.aliases ?? [];
}

export function cliCommandOptions(name: CliCommandName): AfyxRouteOptions | undefined {
  return BY_NAME.get(name)?.hidden ? { hidden: true } : undefined;
}

export interface PreparedCliInvocation {
  argv: string[];
  versionShortcut: boolean;
}

/** Preserve the established first-argument version aliases and global color flags. */
export function prepareCliInvocation(argv: readonly string[]): PreparedCliInvocation {
  const firstArg = argv[2];
  return {
    versionShortcut: firstArg === '-v' || firstArg === '-version',
    argv: argv.filter((argument) => argument !== '--color' && argument !== '--no-color'),
  };
}

/** Fail fast if registration order, aliases, or hidden-state metadata drift. */
export function assertCliCatalog(program: AfyxCli): void {
  const actual = program.catalog();
  const expected = CLI_COMMANDS.map(({ name, aliases, hidden }) => ({
    name,
    aliases: [...aliases],
    hidden,
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`CLI command catalog mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
