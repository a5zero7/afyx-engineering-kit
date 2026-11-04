function repeatedBlock(label, lines = 32) {
  return [
    `${label} synthetic fixture; no private repository content.`,
    ...Array.from({ length: lines }, (_, index) => `${label}/module-${String(index + 1).padStart(3, '0')}.js deterministic record ${index + 1}`),
  ].join('\n');
}

function segment(id, content, classification = 'normal', provenance = {}) {
  return { id, content, classification, provenance };
}

const repeatHeavy = repeatedBlock('repeat-heavy', 48);
const mixedInventory = repeatedBlock('mixed-inventory', 28);
const mixedTool = repeatedBlock('mixed-tool-output', 24);
const protectedText = repeatedBlock('protected-evidence', 18);
const tightNormal = repeatedBlock('tight-normal', 30);
const recoveryText = repeatedBlock('recovery-heavy', 42);

export const BENCHMARK_FIXTURES = Object.freeze([
  {
    id: 'repeat-heavy-v1',
    description: 'Eight exact repeated tool-output segments plus one protected diagnostic.',
    budgetChars: 100_000,
    recovery: 'none',
    segments: [
      segment('repeat-diagnostic', 'E_REPEAT_BOUNDARY must remain byte exact.', 'diagnostic', { fixture: 'repeat-heavy-v1' }),
      ...Array.from({ length: 8 }, (_, index) => segment(`repeat-${index + 1}`, repeatHeavy, 'normal', { fixture: 'repeat-heavy-v1', ordinal: index + 1 })),
    ],
  },
  {
    id: 'mostly-unique-v1',
    description: 'Eight non-repeated synthetic records with enough budget for originals.',
    budgetChars: 100_000,
    recovery: 'none',
    segments: Array.from({ length: 8 }, (_, index) => segment(
      `unique-${index + 1}`,
      repeatedBlock(`unique-${index + 1}`, 18),
      'normal',
      { fixture: 'mostly-unique-v1', ordinal: index + 1 },
    )),
  },
  {
    id: 'mixed-repository-tool-v1',
    description: 'Repeated repository inventory and tool output mixed with unique source evidence.',
    budgetChars: 100_000,
    recovery: 'none',
    segments: [
      ...Array.from({ length: 3 }, (_, index) => segment(`inventory-${index + 1}`, mixedInventory, 'normal', { source: 'synthetic-inventory' })),
      ...Array.from({ length: 3 }, (_, index) => segment(`tool-${index + 1}`, mixedTool, 'normal', { source: 'synthetic-tool' })),
      segment('exact-source', 'export const syntheticIdentity = "AFYX-291";\n', 'source-evidence', { path: 'synthetic/module.js' }),
      segment('unique-summary', repeatedBlock('mixed-unique', 12), 'normal', { source: 'synthetic-summary' }),
    ],
  },
  {
    id: 'protected-evidence-v1',
    description: 'Repeated protected evidence must remain inline while normal repeats may reduce.',
    budgetChars: 100_000,
    recovery: 'none',
    segments: [
      segment('diagnostic-1', protectedText, 'diagnostic', { fixture: 'protected-evidence-v1' }),
      segment('diagnostic-2', protectedText, 'diagnostic', { fixture: 'protected-evidence-v1' }),
      segment('security-1', protectedText, 'security', { fixture: 'protected-evidence-v1' }),
      segment('source-1', protectedText, 'source-evidence', { fixture: 'protected-evidence-v1' }),
      ...Array.from({ length: 4 }, (_, index) => segment(`normal-${index + 1}`, mixedTool, 'normal', { fixture: 'protected-evidence-v1' })),
    ],
  },
  {
    id: 'tight-budget-v1',
    description: 'Budget requires recoverable references while preserving a protected diagnostic.',
    budgetChars: 1_650,
    recovery: 'first-reference',
    segments: [
      segment('tight-diagnostic', 'D'.repeat(1_000), 'diagnostic', { fixture: 'tight-budget-v1' }),
      ...Array.from({ length: 3 }, (_, index) => segment(`tight-${index + 1}`, tightNormal, 'normal', { fixture: 'tight-budget-v1' })),
    ],
  },
  {
    id: 'short-no-gain-v1',
    description: 'Short repeated values remain original because references are larger.',
    budgetChars: 10_000,
    recovery: 'none',
    segments: Array.from({ length: 6 }, (_, index) => segment(`short-${index + 1}`, 'ok', 'normal', { fixture: 'short-no-gain-v1' })),
  },
  {
    id: 'protected-passthrough-v1',
    description: 'Protected content exceeding budget produces byte-complete passthrough.',
    budgetChars: 128,
    recovery: 'none',
    segments: [
      segment('passthrough-security', `SECURITY:${'P'.repeat(600)}`, 'security', { fixture: 'protected-passthrough-v1' }),
      segment('passthrough-normal', repeatedBlock('passthrough-normal', 8), 'normal', { fixture: 'protected-passthrough-v1' }),
    ],
  },
  {
    id: 'recovery-heavy-v1',
    description: 'All reduced references are recovered, exposing gross versus net savings.',
    budgetChars: 100_000,
    recovery: 'all-references',
    segments: Array.from({ length: 8 }, (_, index) => segment(`recovery-${index + 1}`, recoveryText, 'normal', { fixture: 'recovery-heavy-v1', ordinal: index + 1 })),
  },
]);

export function fixtureById(id) {
  const fixture = BENCHMARK_FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`unknown benchmark fixture: ${id}`);
  return fixture;
}

export function rawContext(fixture) {
  return fixture.segments
    .map((item) => `[${item.id}] ${item.classification}\n${item.content}`)
    .join('\n\n');
}
