/**
 * AFYX Engineering Kit - JavaScript and TypeScript Builtin Classifications
 *
 * Provides authoritative definitions for standard global symbols, runtime objects,
 * and primitive types to filter out standard library calls from internal project graphs.
 */

/** Standard runtime global symbols and built-in constructor names. */
export const JS_BUILT_INS: ReadonlySet<string> = new Set<string>([
  'console',
  'window',
  'document',
  'global',
  'process',
  'Promise',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Date',
  'Math',
  'JSON',
  'RegExp',
  'Error',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'fetch',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
]);

/** Canonical TypeScript language primitive types. */
export const TS_PRIMITIVE_TYPES: ReadonlySet<string> = new Set<string>([
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'void',
  'undefined',
  'null',
  'never',
  'unknown',
  'any',
  'object',
]);
