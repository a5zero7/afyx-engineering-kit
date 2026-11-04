/**
 * End-to-end gate for query-path pinning + the segment-vocab supplement +
 * variable seeding, on the bug that motivated all three: an agent named a
 * SvelteKit route file by exact path plus behavior words ("scrollToBottom,
 * onscroll, atBottom tracking") and got back neither the file's scroll code
 * nor the file itself at full weight — the bracketed path was tokenizer
 * shrapnel (`runId` seeded as a named symbol, every sibling `+page` admitted)
 * and the camelCase scroll symbols were FTS-opaque.
 *
 * The fixture mirrors that shape in plain TS (bracket/paren directories are
 * the crux, not the language): a target file under
 * `src/routes/m/projects/[id]/runs/[runId]/` holding `feedAtBottom` /
 * `handleFeedScroll` / `pinFeedIfNearBottom`, a decoy chat-window page under
 * a `(protected)` route group, and a runs-store decoy defining `runId` and
 * `Scope` — the two symbols that headlined the original junk blast radius.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AfyxGraph from '../src/index';
import { ToolHandler } from '../src/mcp/tools';

const FIXTURE = 'explore-path-pinning';
const TARGET = 'src/routes/m/projects/[id]/runs/[runId]/+page.ts';
const DECOY_CHAT = 'src/routes/(protected)/chat-window/+page.ts';

let dir: string;
let cg: AfyxGraph;

async function explore(query: string): Promise<string> {
  const res = await new ToolHandler(cg).execute('afyx_graph_explore', { query });
  return res.content?.[0]?.text ?? '';
}

/** The response renders a source section for `file`. */
const hasSection = (response: string, file: string): boolean =>
  response.includes('**`' + file + '`');

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-path-pin-'));
  fs.cpSync(path.join(__dirname, 'fixtures', FIXTURE), dir, { recursive: true });
  fs.mkdirSync(path.join(dir, '.secret'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.secret', 'install.ps1'),
    "throw 'Synthetic secret must never be exposed.'\n"
  );
  fs.writeFileSync(path.join(dir, 'large.ps1'), `Write-Output 'begin'\n${'# synthetic bounded line\n'.repeat(500)}Write-Output 'end'\n`);
  fs.rmSync(path.join(dir, '.afyx-graph'), { recursive: true, force: true });
  cg = AfyxGraph.initSync(dir);
  await cg.indexAll();
}, 180_000);

afterAll(() => {
  cg?.destroy();
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('fixture shape — if this rots, the gates below mean nothing', () => {
  it('indexes the bracketed-path target with its scroll symbols', () => {
    const names = cg.getNodesInFile(TARGET).map((n) => n.name);
    expect(names).toContain('feedAtBottom');
    expect(names).toContain('handleFeedScroll');
    expect(names).toContain('pinFeedIfNearBottom');
  });
});

describe('path pinning (fix 1)', () => {
  it('a pure-path query renders the named file and says it was pinned', async () => {
    const out = await explore(TARGET);
    expect(hasSection(out, TARGET)).toBe(true);
    expect(out).toContain('pinned from the query');
  });

  it('the original bug-shaped query renders the pinned file, not path shrapnel', async () => {
    const out = await explore(
      `run page auto-scroll to bottom logic in ${TARGET} — scrollToBottom, onscroll, atBottom tracking`,
    );
    expect(hasSection(out, TARGET)).toBe(true);
    // The path fragments must not seed: `runId` (runs-store decoy) and the
    // bracketed segment's namesakes headlined the original junk blast radius.
    const blast = out.split('**Relationships**')[0]!;
    expect(blast).not.toMatch(/`runId` \(src\/lib\/runs-store\.ts/);
    // The chat decoy MAY render — it genuinely holds scroll-pinning code the
    // segment supplement now finds — but the pinned file must rank first.
    // (Pre-fix, `+page`/`runs` shrapnel admitted the siblings ABOVE the named
    // file and the envelope truncated it.)
    const decoyAt = out.indexOf('**`' + DECOY_CHAT + '`');
    const targetAt = out.indexOf('**`' + TARGET + '`');
    expect(targetAt).toBeGreaterThan(-1);
    if (decoyAt !== -1) expect(targetAt).toBeLessThan(decoyAt);
  });

  it('an unresolvable path is reported, not silently dropped', async () => {
    const out = await explore('crash in src/routes/gone/missing-page.ts on load');
    expect(out).toContain('No indexed file uniquely matches');
    expect(out).toContain('src/routes/gone/missing-page.ts');
  });
});

describe('exact unindexed source retrieval (AFYX-260)', () => {
  it('returns bounded direct-source evidence for a root PowerShell path instead of a semantic decoy', async () => {
    const out = await explore('Windows installer flow beginning at install.ps1 with Resolve-Archive staging rollback verification');
    expect(out).toContain('**Exact-file retrieval**');
    expect(out).toContain('bounded direct-source inspection');
    expect(out).toContain('function Resolve-Archive');
    expect(out).toContain('scripts/install-afyx-graph.ps1');
    expect(out).not.toContain('installer-decoy.ts');
    expect(out).toContain('not graph-derived nodes, edges, call relationships');
  });

  it.each([
    ['quoted forward-slash path', 'inspect "scripts/install-afyx-graph.ps1" staging rollback'],
    ['quoted backslash path', 'inspect `scripts\\install-afyx-graph.ps1` staging rollback'],
  ])('%s resolves the same visible PowerShell source', async (_label, query) => {
    const out = await explore(query);
    expect(out).toContain('**`scripts/install-afyx-graph.ps1`** — direct source inspection');
    expect(out).toContain('Expand-Archive');
    expect(out).not.toContain('installer-decoy.ts');
  });

  it('reports a duplicate unsupported basename as ambiguous and substitutes no result', async () => {
    const out = await explore('inspect setup.ps1 installer flow');
    expect(out).toContain('matches multiple visible files');
    expect(out).toContain('one/setup.ps1');
    expect(out).toContain('two/setup.ps1');
    expect(out).toContain('No semantic result was substituted');
    expect(out).not.toContain('installer-decoy.ts');
  });

  it('reports a missing path and substitutes no result', async () => {
    const out = await explore('inspect scripts/missing-installer.ps1 component selection');
    expect(out).toContain('No indexed file uniquely matches');
    expect(out).toContain('No semantic result was substituted');
    expect(out).not.toContain('installer-decoy.ts');
  });

  it('refuses ignored and outside-root paths without exposing source', async () => {
    const ignored = await explore('inspect .secret/install.ps1');
    expect(ignored).toContain('excluded by project ignore policy');
    expect(ignored).not.toContain('Synthetic secret');

    const traversal = await explore('inspect ../outside.ps1');
    expect(traversal).toContain('escapes the authorized project root');
    expect(traversal).not.toContain('installer-decoy.ts');
  });

  it.runIf(process.platform !== 'win32')('refuses an in-project symlink that escapes the project root', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-path-pin-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'secret.ps1'), "throw 'Symlink secret must never be exposed.'\n");
      fs.symlinkSync(path.join(outside, 'secret.ps1'), path.join(dir, 'linked.ps1'));
      const out = await explore('inspect linked.ps1');
      expect(out).toContain('escapes the project through a symlink');
      expect(out).not.toContain('Symlink secret');
      expect(out).not.toContain('installer-decoy.ts');
    } finally {
      fs.rmSync(path.join(dir, 'linked.ps1'), { force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('bounds direct-source output and labels its provenance accurately', async () => {
    const out = await explore('inspect large.ps1');
    expect(out).toContain('direct source inspection · truncated to bounded source window');
    expect(out).toContain('not graph-derived nodes, edges, call relationships');
    expect(out.length).toBeLessThan(8_000);
    expect(out).not.toContain("Write-Output 'end'");
  });

  it('keeps exact indexed TypeScript and open-ended Explore graph-backed', async () => {
    const indexed = await explore('inspect src/lib/installer-decoy.ts component selection');
    expect(hasSection(indexed, 'src/lib/installer-decoy.ts')).toBe(true);
    expect(indexed).toContain('pinned from the query');
    expect(indexed).not.toContain('bounded direct-source inspection');

    const general = await explore('how does installer component selection map staging rollback verification');
    expect(hasSection(general, 'src/lib/installer-decoy.ts')).toBe(true);
    expect(general).not.toContain('**Exact-file retrieval**');
  });
});

describe('extension-less kebab basenames (the amnisphere gap)', () => {
  const KEBAB_TARGET = 'src/lib/background-image-table.ts';

  it('a bare kebab basename — no slash, no extension — pins and renders its file', async () => {
    // Pre-fix this query never opened the path gate; FTS shredded the token
    // into `background`/`image`/`table` and served the fragment decoy instead.
    const out = await explore('background-image-table Source column');
    expect(hasSection(out, KEBAB_TARGET)).toBe(true);
    expect(out).toContain('pinned from the query');
  });

  it('kebab prose that names no file is not reported as an unresolved path', async () => {
    const out = await explore('how does cross-call dedup interact with feed scroll pinning');
    expect(out).not.toContain('No indexed file uniquely matches');
  });
});

describe('segment supplement + variable seeding (fixes 2–3)', () => {
  it('word-level scroll terms reach the camelCase scroll code without a path', async () => {
    const out = await explore('feed auto-scroll to bottom pinning behavior');
    expect(hasSection(out, TARGET)).toBe(true);
  });

  it('a camel infix naming only $state-style variables still finds their file', async () => {
    const out = await explore('where does the atBottom flag get reset');
    expect(hasSection(out, TARGET)).toBe(true);
  });
});
