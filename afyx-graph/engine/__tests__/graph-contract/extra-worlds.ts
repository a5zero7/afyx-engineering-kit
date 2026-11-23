/**
 * Supplementary worlds for the graph contract: container kinds, containment cycles,
 * glob-special names, and the type hierarchy (deep chains, wide fans, dispatch
 * thresholds, relation upgrades, ordering, overrides).
 *
 * Recorded from the implementation before replacement, like the primary contract.
 */
import { GraphWorld, type World } from './fake-store';

/** One container of every kind with a member that something outside calls. */
function containerKinds(): World {
  const g = new GraphWorld();
  const kinds = ['class', 'interface', 'struct', 'union', 'trait', 'protocol', 'module', 'enum', 'namespace', 'function', 'method', 'file'] as const;
  kinds.forEach((kind, i) => {
    g.node(kind, `K_${kind}`, 'src/kinds.ts');
    g.node('method', `m_${kind}`, 'src/kinds.ts');
    g.node('function', `use_${kind}`, 'src/use.ts');
    g.edge(`K_${kind}`, `m_${kind}`, 'contains');
    g.edge(`use_${kind}`, `m_${kind}`, 'calls', i + 1, 0);
    g.edge(`use_${kind}`, `K_${kind}`, 'references', i + 40, 0);
  });
  return g.world();
}

/** X contains Y contains Z contains X, plus a self-contained node. */
function containmentCycle(): World {
  const g = new GraphWorld();
  g.node('class', 'X'); g.node('class', 'Y'); g.node('class', 'Z'); g.node('class', 'Self'); g.node('function', 'caller');
  g.edge('X', 'Y', 'contains'); g.edge('Y', 'Z', 'contains'); g.edge('Z', 'X', 'contains'); g.edge('Self', 'Self', 'contains');
  g.edge('caller', 'Z', 'calls', 1, 0); g.edge('caller', 'Y', 'calls', 2, 0);
  return g.world();
}

/** Qualified names containing every character a glob translation has to escape. */
function globNames(): World {
  const g = new GraphWorld();
  g.node('class', 'Service', 'src/main.ts');
  g.node('function', 'Service', 'src/mainXts');
  g.node('function', 'helper', 'src/util.ts');
  g.node('function', 'hlper', 'src/util.ts');
  g.node('function', 'h.lper', 'src/util.ts');
  ['a+b', 'a(b)', '[x]', 'a$b', 'a^b', 'a{1}', 'a|b', 'a\\b', 'a*b', 'a?b', 'line\nbreak'].forEach((name) => g.node('variable', name, 'src/special.ts'));
  g.node('constant', 'aab', 'src/special.ts');
  g.node('type_alias', 'T', 'src/special.ts');
  g.node('union', 'U', 'src/special.ts');
  g.node('enum', 'E', 'src/special.ts');
  return g.world();
}

export const EXTRA_WORLDS: Record<string, () => World> = { containerKinds, containmentCycle, globNames };
export const EXTRA_GLOBS = [
  '*', 'src/main.ts::Service', 'src/main.ts::*', 'src/util.ts::h?lper', 'src/util.ts::h.lper', 'src/util.ts::h*lper', '?rc/*::*', 'src/special.ts::a+b',
  'src/special.ts::a(b)', 'src/special.ts::[x]', 'src/special.ts::a$b', 'src/special.ts::a^b', 'src/special.ts::a{1}', 'src/special.ts::a|b',
  'src/special.ts::a\\b', 'src/special.ts::a*b', 'src/special.ts::a?b', 'src/special.ts::line?break', 'src/special.ts::*', 'nomatch',
];

// ----------------------------------------------------------------------------------
// Type hierarchy worlds
// ----------------------------------------------------------------------------------

const type = (g: GraphWorld, kind: 'class' | 'interface' | 'struct' | 'trait' | 'enum' | 'type_alias', name: string, file = 'src/types.ts') => g.node(kind, name, file);

/** C0 extends C1 extends ... extends C11. */
function hChain(): World {
  const g = new GraphWorld();
  for (let i = 0; i < 12; i++) type(g, 'class', `C${i}`);
  for (let i = 0; i < 11; i++) g.edge(`C${i}`, `C${i + 1}`, 'extends', i + 1, 0);
  return g.world();
}

/** One base with 450 direct subclasses; the first few have subclasses of their own. */
function hWide(): World {
  const g = new GraphWorld();
  type(g, 'class', 'Base');
  for (let i = 0; i < 450; i++) {
    const name = `S${String(i).padStart(3, '0')}`;
    type(g, 'class', name, `src/sub/${name}.ts`);
    g.edge(name, 'Base', i % 3 === 0 ? 'implements' : 'extends', i + 1, 0);
  }
  for (let i = 0; i < 4; i++) {
    type(g, 'class', `Grand${i}`);
    g.edge(`Grand${i}`, `S00${i}`, 'extends', 900 + i, 0);
  }
  type(g, 'class', 'Small');
  for (let i = 0; i < 3; i++) { type(g, 'class', `Kid${i}`); g.edge(`Kid${i}`, 'Small', 'extends', i + 1, 0); }
  return g.world();
}

/** Interfaces with 7, 8 and 9 implementers, and a class tied to one interface by both relations. */
function hDispatch(): World {
  const g = new GraphWorld();
  for (const [name, count] of [['I7', 7], ['I8', 8], ['I9', 9]] as const) {
    type(g, 'interface', name);
    for (let i = 0; i < count; i++) { type(g, 'class', `${name}_impl${i}`); g.edge(`${name}_impl${i}`, name, 'implements', i + 1, 0); }
  }
  type(g, 'class', 'Both');
  g.edge('Both', 'I7', 'implements', 50, 0); g.edge('Both', 'I7', 'extends', 51, 0);
  type(g, 'class', 'Twice');
  g.edge('Twice', 'I7', 'implements', 60, 0); g.edge('Twice', 'I7', 'implements', 61, 0);
  return g.world();
}

/** Relation upgrades, provenance, and same-level ordering by relation, name, file and line. */
function hOrdering(): World {
  const g = new GraphWorld();
  type(g, 'interface', 'Root');
  g.node('class', 'Zeta', 'src/a.ts'); g.node('class', 'alpha', 'src/b.ts'); g.node('class', 'Beta', 'src/c.ts');
  g.node('class', 'alpha', 'src/a.ts', { id: 'alpha-a500', startLine: 500 }); g.node('class', 'alpha', 'src/a.ts', { id: 'alpha-a100', startLine: 100 });
  g.node('class', 'Impl1', 'src/d.ts'); g.node('class', 'Impl2', 'src/e.ts'); g.node('class', 'UpB', 'src/f.ts'); g.node('class', 'UpA', 'src/g.ts');
  g.node('class', 'Synth', 'src/h.ts'); g.node('class', 'SynthUp', 'src/i.ts');
  for (const id of ['Zeta', 'alpha', 'Beta', 'alpha-a500', 'alpha-a100']) g.edge(id, 'Root', 'extends', 1, 0);
  g.edge('Impl2', 'Root', 'implements', 2, 0); g.edge('Impl1', 'Root', 'implements', 3, 0);
  g.edge('UpB', 'Root', 'implements', 4, 0); g.edge('UpB', 'Root', 'extends', 5, 0);
  g.edge('UpA', 'Root', 'extends', 6, 0); g.edge('UpA', 'Root', 'implements', 7, 0);
  const synthetic = (source: string, kind: 'extends' | 'implements', line: number) => g.edges.push({ source, target: 'Root', kind, line, provenance: 'heuristic' });
  synthetic('Synth', 'implements', 8);
  g.edge('SynthUp', 'Root', 'implements', 9, 0); synthetic('SynthUp', 'extends', 10);
  return g.world();
}

/** A focus with several parents, members of many kinds, and a chain deeper than the override limit. */
function hOverrides(): World {
  const g = new GraphWorld();
  g.node('class', 'Focus', 'src/f.ts');
  for (let i = 1; i <= 14; i++) g.node('class', `A${i}`, `src/a${i}.ts`);
  g.node('interface', 'Iface', 'src/i.ts');
  g.edge('Focus', 'A1', 'extends'); g.edge('Focus', 'Iface', 'implements');
  for (let i = 1; i < 14; i++) g.edge(`A${i}`, `A${i + 1}`, 'extends');
  const member = (owner: string, kind: 'method' | 'function' | 'property' | 'field' | 'variable' | 'constant', name: string, line: number) => {
    g.node(kind, `${owner}.${name}.${kind}`, `src/${owner}.ts`, { name, startLine: line, endLine: line });
    g.edge(owner, `${owner}.${name}.${kind}`, 'contains');
  };
  member('Focus', 'method', 'run', 30); member('Focus', 'function', 'exec', 20); member('Focus', 'property', 'prop', 10); member('Focus', 'field', 'fld', 40);
  member('Focus', 'variable', 'var', 50); member('Focus', 'constant', 'konst', 60); member('Focus', 'method', 'deep', 70); member('Focus', 'method', 'far', 80);
  member('Focus', 'method', 'viaIface', 90); member('Focus', 'method', 'unique', 100);
  member('A1', 'method', 'run', 1); member('A3', 'method', 'run', 1); member('P01', 'function', 'exec', 2); member('A1', 'property', 'prop', 3);
  member('A1', 'field', 'fld', 4); member('A1', 'variable', 'var', 5); member('A1', 'constant', 'konst', 6);
  for (let i = 1; i <= 14; i++) { const name = `P${String(i).padStart(2, '0')}`; g.node('class', name, `src/${name}.ts`); g.edge('Focus', name, 'extends'); }
  member('Focus', 'method', 'wideNear', 110); member('Focus', 'method', 'wideFar', 120); member('P11', 'method', 'wideNear', 11); member('P12', 'method', 'wideFar', 12);
  member('A12', 'method', 'deep', 7); member('A14', 'method', 'far', 8); member('Iface', 'method', 'viaIface', 9);
  return g.world();
}

export const HIERARCHY_WORLDS: Record<string, () => World> = { hChain, hWide, hDispatch, hOrdering, hOverrides };
