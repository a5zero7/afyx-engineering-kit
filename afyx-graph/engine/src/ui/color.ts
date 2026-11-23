type ColorDecision = boolean | undefined;

interface ColorContext {
  arguments: readonly string[];
  environment: NodeJS.ProcessEnv;
  interactive: boolean;
}

type ColorRule = (context: ColorContext) => ColorDecision;

const nonEmpty = (value: string | undefined): value is string => value !== undefined && value !== '';

const explicitArgument: ColorRule = ({ arguments: args }) => {
  if (args.includes('--no-color')) return false;
  if (args.includes('--color')) return true;
  return undefined;
};

const standardEnvironment: ColorRule = ({ environment }) => {
  if (nonEmpty(environment.NO_COLOR)) return false;
  if (!nonEmpty(environment.FORCE_COLOR)) return undefined;
  return !['0', 'false'].includes(environment.FORCE_COLOR.toLowerCase());
};

const terminalCapability: ColorRule = ({ environment, interactive }) => {
  if (interactive && environment.TERM !== 'dumb') return true;
  if (nonEmpty(environment.CI)) return true;
  return undefined;
};

const COLOR_POLICY: readonly ColorRule[] = [
  explicitArgument,
  standardEnvironment,
  terminalCapability,
];

/** Resolve the single ANSI policy used by all Afyx-authored terminal output. */
export function ansiColorsEnabled(): boolean {
  const context: ColorContext = {
    arguments: process.argv,
    environment: process.env,
    interactive: process.stdout.isTTY === true,
  };

  for (const rule of COLOR_POLICY) {
    const decision = rule(context);
    if (decision !== undefined) return decision;
  }
  return false;
}
