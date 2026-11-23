/**
 * AFYX Engineering Kit - Swift and Objective-C Interop Bridging
 *
 * Implements deterministic bidirectional selector translation rules between
 * Swift method signatures and Objective-C selectors, supporting @objc annotations,
 * initializers, property accessors, and selector un-mangling.
 */

function capitalizeFirst(text: string): string {
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function uncapitalizeFirst(text: string): string {
  return text.length > 0 ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/**
 * Computes Objective-C runtime selector for a Swift method declaration.
 */
export function objcSelectorForSwiftMethod(
  baseName: string,
  externalLabels: (string | null)[],
  explicitObjcName?: string | null
): string | null {
  if (!baseName) return null;
  if (explicitObjcName) return explicitObjcName;

  if (externalLabels.length === 0) {
    return baseName;
  }

  const [initialLabel, ...subsequentLabels] = externalLabels;
  const isInitialUnlabeled =
    initialLabel === null || initialLabel === undefined || initialLabel === '_' || initialLabel === '';

  const initialKeyword = isInitialUnlabeled
    ? `${baseName}:`
    : `${baseName}With${capitalizeFirst(initialLabel)}:`;

  const remainingKeywords = subsequentLabels.map((lbl) => `${lbl ?? ''}:`).join('');
  return initialKeyword + remainingKeywords;
}

/**
 * Computes Objective-C selector for a Swift initializer (init).
 */
export function objcSelectorForSwiftInit(
  externalLabels: (string | null)[],
  internalNames: string[],
  explicitObjcName?: string | null
): string | null {
  if (explicitObjcName) return explicitObjcName;

  if (externalLabels.length === 0) {
    return 'init';
  }

  const [firstExternal, ...remainingExternals] = externalLabels;
  const [firstInternal] = internalNames;

  const firstEffective =
    firstExternal === null || firstExternal === '_' || firstExternal === ''
      ? firstInternal
      : firstExternal;

  if (!firstEffective) return null;

  const prefixKeyword = `initWith${capitalizeFirst(firstEffective)}:`;
  const trailingKeywords = remainingExternals
    .map((lbl, idx) => {
      const fallbackInternal = internalNames[idx + 1];
      const effectiveName = lbl && lbl !== '_' ? lbl : fallbackInternal ?? '';
      return `${effectiveName}:`;
    })
    .join('');

  return prefixKeyword + trailingKeywords;
}

/**
 * Computes getter and setter selectors for a Swift property exposed to Objective-C.
 */
export function objcAccessorsForSwiftProperty(
  swiftName: string,
  explicitObjcName?: string | null
): { getter: string; setter: string } | null {
  if (!swiftName) return null;

  const getterSelector = explicitObjcName ?? swiftName;
  return {
    getter: getterSelector,
    setter: `set${capitalizeFirst(getterSelector)}:`,
  };
}

/**
 * Derives possible Swift base names corresponding to an Objective-C selector.
 */
export function swiftBaseNamesForObjcSelector(selector: string): string[] {
  if (!selector) return [];

  const sanitized = selector.replace(/:+$/g, '');
  const segments = sanitized.split(':');
  const primaryKeyword = segments[0];
  if (!primaryKeyword) return [];

  const resolvedCandidates = new Set<string>();
  resolvedCandidates.add(primaryKeyword);

  if (primaryKeyword.startsWith('initWith')) {
    resolvedCandidates.add('init');
  }

  // Handle preposition-prefixed patterns (e.g. playWithSong -> play, objectForKey -> object)
  const prepMatch = primaryKeyword.match(/^([a-z][a-zA-Z0-9]*?)(?:With|For|By|In|On|At|From|To|Of|As)[A-Z]/);
  if (prepMatch && prepMatch[1]) {
    resolvedCandidates.add(prepMatch[1]);
  }

  // Handle setter pattern (setName: -> name)
  if (segments.length === 1 && /^set[A-Z]/.test(primaryKeyword) && selector.endsWith(':')) {
    const propertyIdentifier = uncapitalizeFirst(primaryKeyword.slice(3));
    if (propertyIdentifier) {
      resolvedCandidates.add(propertyIdentifier);
    }
  }

  return Array.from(resolvedCandidates);
}

/**
 * Parses source code slice preceding declaration to extract explicit `@objc(selector)` override.
 */
export function detectExplicitObjcName(sourceSlice: string): string | null {
  const match = sourceSlice.match(/@objc\s*\(\s*([^)\s]+)\s*\)/);
  return match && match[1] ? match[1] : null;
}

/**
 * Detects whether a Swift symbol is explicitly or contextually exposed to Objective-C.
 */
export function isObjcExposed(sourceSlice: string): boolean {
  if (/@nonobjc\b/.test(sourceSlice)) return false;
  return /@objc\b/.test(sourceSlice);
}
