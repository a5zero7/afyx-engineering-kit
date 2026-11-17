import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { convertDocument, inspectDocument, listSupportedFormats } from '../afyx-document-intelligence.mjs';
import { crc32 } from '../afyx-document-archive.mjs';

function zip(items, { compressed = false, attributes = 0 } = {}) {
  const locals = []; const directory = []; let offset = 0;
  for (const [name, value] of items) {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const packed = compressed ? deflateRawSync(data) : data; const filename = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(compressed ? 8 : 0, 8); local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(compressed ? 8 : 0, 10); central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(attributes >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, filename, packed); directory.push(central, filename); offset += local.length + filename.length + packed.length;
  }
  const central = Buffer.concat(directory); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
const convert = (name, text, policy = {}, extra = {}) => convertDocument({ name, bytes: Buffer.isBuffer(text) ? text : Buffer.from(text), ...extra }, policy);
const rejected = (result, code) => { assert.equal(result.status, 'BLOCKED', JSON.stringify(result)); assert.match(result.diagnostics[0].code, code); assert.equal(result.markdown, ''); };
const xml = (s) => `<?xml version="1.0" encoding="UTF-8"?>${s}`;
const types = ['[Content_Types].xml', '<Types/>'];

test('native formats report precise supported subsets and PDF limitation', () => {
  const formats = listSupportedFormats(); assert.equal(formats.contract, 'AfyxDocument/v1');
  assert.equal(formats.formats.length, 11); assert.equal(formats.network, false);
  assert.equal(formats.formats.find((f) => f.id === 'pdf').status, 'UNSUPPORTED');
});

for (const [name, input, expected] of [
  ['readme.txt', 'Halo 🌏\r\nBaris dua', 'Halo 🌏\nBaris dua'],
  ['readme.md', '# Title\n\n- item\n\n```js\nx()\n```', '# Title\n\n- item\n\n```js\nx()\n```'],
  ['empty.txt', '', ''],
  ['data.csv', 'name,value\n"a,b","two\nlines"\n', '| name | value |\n| --- | --- |\n| a,b | two<br>lines |'],
  ['data.json', '{"items":[1,"🌏"]}', '```json\n{\n  "items": [\n    1,\n    "🌏"\n  ]\n}\n```'],
  ['data.xml', '<root><value>✓ &amp; &#65;</value></root>', '```xml\n<root><value>✓ &amp; &#65;</value></root>\n```'],
]) test(`deterministic conversion ${name}`, async () => {
  const result = await convert(name, input); assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result));
  assert.equal(result.markdown, expected); assert.equal(result.untrusted, true);
  assert.match(result.source.sha256, /^[a-f0-9]{64}$/); assert.equal(result.references[0].sourceSha256, result.source.sha256);
  assert.deepEqual(await convert(name, input), result);
});

test('HTML retains headings lists tables code links and ignores executable elements', async () => {
  const result = await convert('web.html', '<h1>Title</h1><p>Hello <strong>world</strong> <a href="https://example.invalid/a">link</a></p><ul><li>A</li></ul><table><tr><th>X</th><th>Y</th></tr><tr><td>1</td><td>2</td></tr></table><pre>let a = 1;</pre><script>EVIL()</script><a href="file:///secret">secret</a>');
  assert.equal(result.status, 'SUCCEEDED'); assert.match(result.markdown, /# Title/); assert.match(result.markdown, /\*\*world\*\*/);
  assert.match(result.markdown, /\[link\]\(https:\/\/example.invalid\/a\)/); assert.match(result.markdown, /\| X \| Y \|/);
  assert.match(result.markdown, /```\nlet a = 1;/); assert.doesNotMatch(result.markdown, /EVIL|file:\/\//);
});

test('UTF-16 BOM and byte stream input preserve Unicode without network or writes', async () => {
  const bytes = Buffer.concat([Buffer.from([255, 254]), Buffer.from('Halo Ω', 'utf16le')]);
  assert.equal((await convert('unicode.txt', bytes)).markdown, 'Halo Ω');
  async function* stream() { yield Buffer.from('α'); yield Buffer.from('β'); }
  const result = await convertDocument({ stream: stream(), name: 'stream.txt' }, {});
  assert.equal(result.markdown, 'αβ');
  rejected(await convert('bad.txt', Buffer.from([0xc3, 0x28])), /ENCODING_INVALID/);
});

test('path input uses trusted workspace and read-only inspect preserves source bytes', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-doc-readonly-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'a.md'); writeFileSync(path, '# Hello');
  const names = readdirSync(root); const original = readFileSync(path);
  const result = await inspectDocument({ path }, { workspaceRoot: root });
  assert.equal(result.status, 'SUCCEEDED'); assert.equal(Object.hasOwn(result, 'markdown'), false); assert.equal(result.outputBytes, 7);
  assert.deepEqual(readFileSync(path), original); assert.deepEqual(readdirSync(root), names);
  rejected(await convertDocument({ path }, {}), /WORKSPACE_REQUIRED/);
  rejected(await convertDocument({ path: '../outside.txt' }, { workspaceRoot: root }), /OUTSIDE_WORKSPACE/);
  rejected(await convertDocument({ path: 'a.md:secret' }, { workspaceRoot: root }), /PATH_INVALID/);
});

test('hardlinks and symlink/junction paths are rejected', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-doc-links-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const real = join(root, 'real.txt'); writeFileSync(real, 'owner'); linkSync(real, join(root, 'hard.txt'));
  rejected(await convertDocument({ path: real }, { workspaceRoot: root }), /NOT_PRIVATE_REGULAR/);
  const directory = join(root, 'directory'); mkdirSync(directory); writeFileSync(join(directory, 'doc.txt'), 'data');
  const alias = join(root, 'alias'); symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
  rejected(await convertDocument({ path: join(alias, 'doc.txt') }, { workspaceRoot: root }), /SYMLINK_FORBIDDEN/);
});

test('ZIP stored and deflated text documents convert without extraction', async () => {
  for (const compressed of [false, true]) {
    const result = await convert('bundle.zip', zip([['notes.txt', 'Hello'], ['folder/data.csv', 'A,B\n1,2']], { compressed }));
    assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result)); assert.match(result.markdown, /## notes.txt\n\nHello/);
    assert.equal(result.metadata.members, 2); assert.equal(result.references[1].name, 'folder/data.csv');
  }
  assert.equal((await convert('empty.zip', zip([]))).markdown, '');
});

test('DOCX heading paragraph list and table preserve source part references', async () => {
  const document = xml('<w:document xmlns:w="word"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p><w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Item</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
  const result = await convert('a.docx', zip([types, ['word/document.xml', document],
    ['docProps/core.xml', '<cp:coreProperties><dc:title>Actual title</dc:title><dc:creator>Author Ω</dc:creator></cp:coreProperties>']]));
  assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result)); assert.match(result.markdown, /^# Title/); assert.match(result.markdown, /- Item/);
  assert.match(result.markdown, /\| Cell \|/); assert.equal(result.references.length, 3); assert.equal(result.references[0].part, 'word/document.xml');
  assert.deepEqual(result.metadata.properties, { title: 'Actual title', creator: 'Author Ω' });
});

test('XLSX preserves workbook order sheet names sparse cells strings and cached formulas', async () => {
  const result = await convert('a.xlsx', zip([types,
    ['xl/workbook.xml', '<workbook><sheets><sheet name="Data Ω" r:id="s2"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s2" Target="/xl/worksheets/sheet2.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', '<sst><si><t>Header</t></si></sst>'],
    ['xl/worksheets/sheet2.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Tail</t></is></c></row><row r="2"><c r="A2"><f>1+1</f><v>2</v></c><c r="C2"><f>NOW()</f></c></row></sheetData></worksheet>'],
  ]));
  assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result)); assert.match(result.markdown, /## Data Ω/);
  assert.match(result.markdown, /\| Header \|  \| Tail \|/); assert.match(result.markdown, /formula has no cached value/);
  assert.equal(result.metadata.formulasEvaluated, false); assert.equal(result.references[0].part, 'xl/worksheets/sheet2.xml');
});

test('PPTX uses declared presentation order rather than ZIP order', async () => {
  const result = await convert('a.pptx', zip([types,
    ['ppt/presentation.xml', '<p:presentation><p:sldIdLst><p:sldId r:id="b"/><p:sldId r:id="a"/></p:sldIdLst></p:presentation>'],
    ['ppt/_rels/presentation.xml.rels', '<Relationships><Relationship Id="a" Target="slides/slide1.xml"/><Relationship Id="b" Target="slides/slide2.xml"/></Relationships>'],
    ['ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>'],
    ['ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>'],
  ]));
  assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result)); assert.match(result.markdown, /Slide 1\n\nFirst[\s\S]*Slide 2\n\nSecond/);
});

test('OOXML external links are counted but never fetched or treated as local parts', async () => {
  const bytes = zip([types, ['word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Visible text only</w:t></w:r></w:p></w:body></w:document>'],
    ['word/_rels/document.xml.rels', '<Relationships><Relationship Id="remote" TargetMode="External" Target="http://169.254.169.254/secret"/></Relationships>']]);
  const result = await convert('external.docx', bytes);
  assert.equal(result.status, 'SUCCEEDED'); assert.equal(result.metadata.externalRelationshipsIgnored, 1);
  assert.equal(result.markdown, 'Visible text only');
});

for (const [label, name, input, code] of [
  ['XXE', 'a.xml', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]><x>&e;</x>', /DTD_FORBIDDEN/],
  ['broken XML', 'a.xml', '<a><b></a>', /UNBALANCED/],
  ['unknown XML entity', 'a.xml', '<a>&unknown;</a>', /ENTITY_INVALID/],
  ['broken JSON', 'a.json', '{bad', /JSON_MALFORMED/],
  ['unclosed CSV', 'a.csv', 'a,"b', /UNCLOSED_QUOTE/],
  ['ZIP traversal', 'a.zip', zip([['../secret.txt', 'x']]), /ZIP_PATH_UNSAFE/],
  ['ZIP absolute path', 'a.zip', zip([['/root/a.txt', 'x']]), /ZIP_PATH_UNSAFE/],
  ['ZIP drive path', 'a.zip', zip([['C:/a.txt', 'x']]), /ZIP_PATH_UNSAFE/],
  ['ZIP backslash', 'a.zip', zip([['a\\b.txt', 'x']]), /ZIP_PATH_UNSAFE/],
  ['ZIP duplicate', 'a.zip', zip([['a.txt', '1'], ['A.txt', '2']]), /ZIP_PATH_UNSAFE/],
  ['ZIP symlink', 'a.zip', zip([['a.txt', 'target']], { attributes: 0xa1ff0000 }), /SPECIAL_FILE/],
  ['ZIP executable', 'a.zip', zip([['run.exe', 'MZ']]), /EXECUTABLE_FORBIDDEN/],
  ['ZIP macro', 'a.docx', zip([types, ['word/vbaProject.bin', 'x']]), /EXECUTABLE_FORBIDDEN/],
  ['ZIP nesting', 'a.zip', zip([['nested.zip', zip([])]]), /RECURSION_FORBIDDEN/],
  ['ZIP bomb', 'a.zip', zip([['big.txt', 'A'.repeat(100_000)]], { compressed: true }), /EXPANSION_LIMIT/],
  ['OOXML missing part', 'a.docx', zip([types]), /REQUIRED_PART_MISSING/],
  ['binary spoof', 'a.txt', Buffer.from([0, 1, 2]), /BINARY_TEXT/],
]) test(`reject ${label} truthfully`, async () => rejected(await convert(name, input), code));

test('signature and MIME conflicts cannot select a different decoder', async () => {
  rejected(await convert('a.docx', '<not-a-zip/>'), /SIGNATURE_MISMATCH/);
  rejected(await convert('a.txt', '%PDF-1.4'), /SIGNATURE_MISMATCH/);
  rejected(await convert('a.json', '{}', {}, { mime: 'text/html' }), /MIME_MISMATCH/);
  assert.equal((await convert('a.pdf', '%PDF-1.4\n%%EOF')).status, 'UNSUPPORTED');
  assert.equal((await convert('a.yaml', 'x: 1')).status, 'UNSUPPORTED');
});

test('ZIP local header, corruption and encryption are rejected', async () => {
  const bytes = zip([['a.txt', 'hello']]);
  const broken = Buffer.from(bytes); broken[35] ^= 1;
  rejected(await convert('a.zip', broken), /CONTENT_INTEGRITY/);
  const wrongName = Buffer.from(bytes); wrongName[30] = 'b'.charCodeAt(0);
  rejected(await convert('a.zip', wrongName), /LOCAL_HEADER/);
  const encrypted = Buffer.from(bytes); encrypted.writeUInt16LE(0x801, 6); encrypted.writeUInt16LE(0x801, 30 + 5 + 5 + 8);
  rejected(await convert('a.zip', encrypted), /COMPRESSION_UNSUPPORTED/);
});

test('trusted budgets reject input output inflation entries time and escalation', async () => {
  rejected(await convert('a.txt', 'too large', { limits: { maxInputBytes: 2 } }), /INPUT_LIMIT/);
  rejected(await convert('a.txt', 'too large', { limits: { maxOutputBytes: 2 } }), /OUTPUT_LIMIT/);
  rejected(await convert('a.zip', zip([['a.txt', '123'], ['b.txt', '456']]), { limits: { maxInflatedBytes: 4 } }), /EXPANSION_LIMIT/);
  rejected(await convert('a.zip', zip([['a.txt', '1'], ['b.txt', '2']]), { limits: { maxEntries: 1 } }), /ENTRY_LIMIT/);
  rejected(await convert('a.txt', 'small', { limits: { maxTimeMs: 1 } }), /TIME_LIMIT/);
  rejected(await convert('a.txt', 'small', { limits: { maxInputBytes: 1_000_000_000 } }), /LIMIT_POLICY_INVALID/);
  rejected(await convert('a.txt', 'small', { limits: { maxMemoryMb: -1 } }), /LIMIT_POLICY_INVALID/);
  assert.equal((await convert('a.txt', 'recovered')).status, 'SUCCEEDED');
});

test('stalled stream returns bounded timeout without awaiting hostile cleanup', async () => {
  const stream = { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: () => new Promise(() => {}) }; } };
  const start = Date.now(); const result = await convertDocument({ stream, name: 'a.txt' }, { limits: { maxTimeMs: 50 } });
  rejected(result, /TIME_LIMIT/); assert.ok(Date.now() - start < 1500);
});

test('CLI help is a read-only versioned capability listing', () => {
  const result = spawnSync(process.execPath, [new URL('../afyx-document-intelligence.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).contract, 'AfyxDocument/v1');
});

test('malformed deep XML and missing paths report bounded diagnostics without source excerpts', async (t) => {
  rejected(await convert('deep.xml', '<a>'.repeat(140) + '</a>'.repeat(140)), /XML_DEPTH_LIMIT/);
  const root = mkdtempSync(join(tmpdir(), 'afyx-doc-errors-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = await convertDocument({ path: join(root, 'private-missing.txt') }, { workspaceRoot: root });
  rejected(result, /^DOCUMENT_FILESYSTEM_ENOENT$/); assert.doesNotMatch(JSON.stringify(result.diagnostics), /private-missing|afyx-doc-errors/);
});
