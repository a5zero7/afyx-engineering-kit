import { describe, expect, it } from 'vitest';
import { guardsInSource } from '../src/graph/branch-guards';
import type { Language } from '../src/types';

interface Fixture {
  language: Language;
  source: string;
  sites: readonly string[];
}

const jsSource = `
function route(mode, ready) {
  if (!ready) return
  if (mode === 'a') {
    first()
  } else {
    second()
  }
  switch (mode) {
    case 'b': third(); break
    default: fourth()
  }
  const value = ready ? yes() : no()
  ready && later()
  try { risky() } catch (error) { report(error) }
}
`;

const jsSites = ['first()', 'second()', 'third()', 'fourth()', 'yes()', 'no()', 'later()', 'report(error)'];
const fixtures: readonly Fixture[] = [
  ...(['typescript', 'tsx', 'javascript', 'jsx'] as const).map((language) => ({ language, source: jsSource, sites: jsSites })),
  {
    language: 'python',
    source: `
def route(mode, ready):
    if not ready:
        return None
    if mode == "a":
        first()
    elif mode == "b":
        second()
    else:
        third()
    match mode:
        case "c":
            fourth()
        case _:
            fifth()
    value = yes() if ready else no()
    ready and later()
    ready or fallback()
    if (
        mode == "multi"
        and ready
    ):
        multiline()
    try:
        risky()
    except ValueError:
        report()
`,
    sites: ['first()', 'second()', 'third()', 'fourth()', 'fifth()', 'yes()', 'no()', 'later()', 'fallback()', 'multiline()', 'report()'],
  },
  {
    language: 'java',
    source: `
class Route {
  void run(String mode, boolean ready) {
    if (!ready) return;
    if (mode.equals("a")) { first(); } else { second(); }
    switch (mode) {
      case "b": third(); break;
      case "modern" -> modern();
      default: fourth();
    }
    int value = ready ? yes() : no();
    ready && later();
    ready || fallback();
    try { risky(); } catch (RuntimeException error) { report(error); }
  }
}
`,
    sites: ['first()', 'second()', 'third()', 'modern()', 'fourth()', 'yes()', 'no()', 'later()', 'fallback()', 'report(error)'],
  },
  {
    language: 'go',
    source: `
func route(mode string, ready bool) {
  if err := validate(); err != nil { return }
  if !ready { panic("not ready") }
  if fatal { log.Fatal("fatal") }
  if mode == "a" { first() } else if mode == "b" { second() } else { third() }
  switch mode {
  case "c": fourth()
  default: fifth()
  }
  ready && later()
  ready || fallback()
  afterFatal()
}
`,
    sites: ['first()', 'second()', 'third()', 'fourth()', 'fifth()', 'later()', 'fallback()', 'afterFatal()'],
  },
  {
    language: 'kotlin',
    source: `
class OwnerController {
  fun run(owner: Owner, result: Result) {
    if (result.hasErrors()) { return }
    try { save(owner) } catch (error: IllegalStateException) { report(error) }
    when (owner.kind) {
      A -> remove(owner)
      else -> fallback()
    }
    val value = if (ready) yes() else no()
    ready && later()
  }
}
`,
    sites: ['save(owner)', 'report(error)', 'remove(owner)', 'fallback()', 'yes()', 'no()', 'later()'],
  },
];

async function results(fixture: Fixture) {
  const lines = fixture.source.split('\n');
  return Promise.all(fixture.sites.map(async (site) => {
    const row = lines.findIndex((line) => line.includes(site));
    const guards = await guardsInSource(
      fixture.source, fixture.language, row + 1, lines[row]!.indexOf(site)
    );
    return guards.map(({ text, negated, form, line, branch, armExit, exit }) => ({
      text, negated, form, line, branch, armExit: armExit ?? null, exit: exit ?? null,
    }));
  }));
}

describe('native branch guard contract', () => {
  for (const fixture of fixtures) {
    it(`${fixture.language}: preserves guard structure and metadata`, async () => {
      const first = await results(fixture);
      expect(first.some((guards) => guards.length > 0)).toBe(true);
      await expect(results(fixture)).resolves.toEqual(first);
    });
  }

  it('does not leak syntax-looking text or guards across semantic boundaries', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const cases: Array<{ language: Language; source: string; site: string }> = [
      { language: 'python', source: 'def a():\n    if x:\n        return\ndef b():\n    text = "if fake:"\n    # if fake:\n    run()\n', site: 'run()' },
      { language: 'java', source: 'class A { void a(){ if(x)return; } void b(){ String s="if(fake)"; /* if (fake) */ run(); } }', site: 'run()' },
      { language: 'go', source: 'func a(){ if x { return } }\nfunc b(){ s := "if fake"; // if fake\n run()\n}', site: 'run()' },
      { language: 'python', source: 'def f():\n    if outer: return\n    callback = lambda: run()\n', site: 'run()' },
      { language: 'java', source: 'class A { void f(){ if(outer)return; Runnable callback=()->{ run(); }; } }', site: 'run()' },
      { language: 'go', source: 'func f(){ if outer { return }; callback := func(){ run() }; _ = callback }', site: 'run()' },
      { language: 'kotlin', source: 'class A { fun f(){ if(outer)return; val callback = { run() } } }', site: 'run()' },
    ];
    for (const item of cases) {
      const lines = item.source.split('\n');
      const row = lines.findIndex((line) => line.includes(item.site));
      expect(await guardsInSource(item.source, item.language, row + 1, lines[row]!.indexOf(item.site)), item.language).toEqual([]);
    }
  });

  it('handles incomplete native source deterministically without throwing', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const cases: Array<[string, Language, number, number]> = [
      ['def f():\n    if (ready\n        run()\n', 'python', 3, 8],
      ['class A { void f() { if (ready) { run();', 'java', 1, 34],
      ['func f() { if ready { run()', 'go', 1, 22],
    ];
    for (const args of cases) {
      const first = await guardsInSource(...args);
      await expect(guardsInSource(...args)).resolves.toEqual(first);
    }
  });

  it('keeps Go guards inside their assigned function-literal execution boundary', async () => {
    process.env.AFYX_GRAPH_NATIVE_PARSER = '1';
    const source = `func f() {
  if outer { return }
  callback := func() {
    if inner { run() }
  }
  _ = callback
}`;
    expect(await guardsInSource(source, 'go', 4, 15)).toEqual([
      expect.objectContaining({ text: 'inner', negated: false, form: 'if', line: 4 }),
    ]);
  });
});
