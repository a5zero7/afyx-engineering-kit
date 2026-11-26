import { parseDelimitedRows } from './afyx-context-source.mjs';
import { readArchive } from './afyx-document-archive.mjs';
import { readXml, children, descendants, localName, textOf } from './afyx-document-xml.mjs';

const extensionFormats = { txt: 'txt', md: 'md', markdown: 'md', html: 'html', htm: 'html', csv: 'csv',
  json: 'json', xml: 'xml', zip: 'zip', docx: 'docx', xlsx: 'xlsx', pptx: 'pptx', pdf: 'pdf' };
const mimeFormats = { 'text/plain': 'txt', 'text/markdown': 'md', 'text/html': 'html', 'text/csv': 'csv',
  'application/json': 'json', 'application/xml': 'xml', 'text/xml': 'xml', 'application/zip': 'zip',
  'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx' };
const unsupported = (reason) => { const e = new Error(reason); e.unsupported = true; throw e; };
export const formatNames = Object.freeze(Object.values(extensionFormats).filter((v, i, a) => a.indexOf(v) === i));
export function detectFormat(bytes, name, mime) {
  const ext = name.split('.').at(-1)?.toLowerCase();
  const format = extensionFormats[ext];
  const declared = mime && mimeFormats[mime.toLowerCase().split(';')[0].trim()];
  if (mime && !declared) unsupported('DOCUMENT_MIME_UNSUPPORTED');
  if (format && declared && format !== declared && !(format === 'zip' && ['docx', 'xlsx', 'pptx'].includes(declared))) throw new Error('DOCUMENT_MIME_MISMATCH');
  const selected = format || declared;
  if (!selected) unsupported('DOCUMENT_FORMAT_UNSUPPORTED');
  const zip = bytes.length >= 4 && [0x04034b50, 0x06054b50].includes(bytes.readUInt32LE(0));
  const pdf = bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (['zip', 'docx', 'xlsx', 'pptx'].includes(selected) !== zip || (selected === 'pdf') !== pdf) throw new Error('DOCUMENT_SIGNATURE_MISMATCH');
  return selected;
}
export function decodeText(bytes) {
  let encoding = 'utf-8'; let offset = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) { encoding = 'utf-16le'; offset = 2; }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) { encoding = 'utf-16be'; offset = 2; }
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset)).replace(/^\uFEFF/, '');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error('DOCUMENT_BINARY_TEXT_REJECTED');
  return text.replace(/\r\n?/g, '\n');
}
const escape = (s) => String(s).replace(/([\\`*_\[\]<>#])/g, '\\$1');
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
function table(rows) {
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  if (width > 256) throw new Error('DOCUMENT_TABLE_COLUMN_LIMIT');
  const render = (r) => `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? '')).join(' | ')} |`;
  return [render(rows[0]), render(Array(width).fill('---')), ...rows.slice(1).map(render)].join('\n');
}
function html(text, check) {
  // HTML is interpreted only as inert text tokens. No browser, network or scripts.
  const entities = (s) => s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (v) => {
    const map = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
    if (map[v.toLowerCase()]) return map[v.toLowerCase()];
    const n = v[2].toLowerCase() === 'x' ? parseInt(v.slice(3, -1), 16) : Number(v.slice(2, -1));
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
  });
  const cleaned = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  let output = ''; let pre = false; const links = []; let rows = []; let currentRow = null; let currentCell = null;
  const append = (v) => { if (currentCell !== null) currentCell += v; else output += v; };
  for (const token of cleaned.matchAll(/<[^>]*>|[^<]+/g)) {
    check(); const value = token[0];
    if (!value.startsWith('<')) { append(pre ? entities(value) : escape(entities(value.replace(/\s+/g, ' ')))); continue; }
    const match = /^<\s*(\/?)\s*([\w-]+)/.exec(value); if (!match) continue;
    const end = !!match[1]; const tag = match[2].toLowerCase();
    if (tag === 'table') { if (!end) rows = []; else { append(`\n\n${table(rows)}\n\n`); rows = []; } }
    else if (tag === 'tr') { if (!end) currentRow = []; else { if (currentRow) rows.push(currentRow); currentRow = null; } }
    else if (tag === 'td' || tag === 'th') { if (!end) currentCell = ''; else { if (currentRow && currentCell !== null) currentRow.push(currentCell); currentCell = null; } }
    else if (/^h[1-6]$/.test(tag)) append(end ? '\n\n' : `\n\n${'#'.repeat(Number(tag[1]))} `);
    else if (['p', 'div', 'section', 'article', 'ul', 'ol'].includes(tag)) append('\n\n');
    else if (tag === 'li') append(end ? '\n' : '\n- ');
    else if (tag === 'br' || tag === 'hr') append('\n');
    else if (tag === 'pre') { pre = !end; append(end ? '\n```\n' : '\n```\n'); }
    else if (tag === 'code' && !pre) append('`');
    else if (['strong', 'b'].includes(tag)) append('**');
    else if (['em', 'i'].includes(tag)) append('*');
    else if (tag === 'a') {
      if (!end) {
        const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(value);
        const url = entities(href?.[1] ?? href?.[2] ?? href?.[3] ?? '');
        const safe = /^(?:https?:\/\/|mailto:|#)/i.test(url) && !/[\x00-\x20()\\]/.test(url);
        links.push(safe ? url : null); if (safe) append('[');
      } else { const url = links.pop(); if (url) append(`](${url})`); }
    }
  }
  return output.replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const memberXml = (entries, name, check) => {
  const bytes = entries.get(name); if (!bytes) throw new Error(`OOXML_REQUIRED_PART_MISSING:${name}`);
  return readXml(decodeText(bytes), check);
};
function assertRoot(document, name) {
  if (localName(children(document)[0]) !== name) throw new Error('OOXML_ROOT_INVALID');
}
function relationshipMap(entries, path, check) {
  const map = new Map();
  if (!entries.has(path)) return map;
  for (const rel of descendants(memberXml(entries, path, check), 'Relationship')) {
    if (rel.attrs.TargetMode === 'External') continue;
    if (!rel.attrs.Id || !rel.attrs.Target || map.has(rel.attrs.Id)) throw new Error('OOXML_RELATIONSHIP_INVALID');
    map.set(rel.attrs.Id, rel.attrs.Target);
  }
  return map;
}
function safeTarget(base, target) {
  if (!target || target.startsWith('//') || target.includes('\\') || target.includes(':') || target.split('/').some((p) => p === '..' || p === '.')) throw new Error('OOXML_TARGET_UNSAFE');
  return target.startsWith('/') ? target.slice(1) : `${base}/${target}`;
}
function word(entries, check) {
  const doc = memberXml(entries, 'word/document.xml', check); const blocks = [];
  assertRoot(doc, 'document');
  if (children(children(doc)[0], 'body').length !== 1) throw new Error('OOXML_BODY_INVALID');
  const paragraph = (p) => {
    let value = '';
    const walk = (node) => {
      for (const child of children(node)) {
        const name = localName(child);
        if (name === 't') value += escape(textOf(child));
        else if (name === 'tab') value += '\t';
        else if (['br', 'cr'].includes(name)) value += '\n';
        else walk(child);
      }
    };
    walk(p);
    const style = descendants(p, 'pStyle')[0]?.attrs['w:val'] ?? '';
    const heading = /^Heading([1-6])$/i.exec(style);
    if (heading) value = `${'#'.repeat(Number(heading[1]))} ${value}`;
    else if (descendants(p, 'numPr').length) value = `- ${value}`;
    return value;
  };
  for (const body of descendants(doc, 'body')) for (const block of children(body)) {
    check();
    if (localName(block) === 'p') blocks.push(paragraph(block));
    else if (localName(block) === 'tbl') blocks.push(table(children(block, 'tr').map((r) => children(r, 'tc').map((c) => descendants(c, 'p').map(paragraph).join('\n')))));
  }
  return { markdown: blocks.join('\n\n'), references: blocks.map((_, i) => ({ kind: 'paragraph-or-table', part: 'word/document.xml', index: i + 1 })) };
}
function spreadsheet(entries, check) {
  const workbook = memberXml(entries, 'xl/workbook.xml', check);
  assertRoot(workbook, 'workbook');
  const relationships = relationshipMap(entries, 'xl/_rels/workbook.xml.rels', check);
  const strings = entries.has('xl/sharedStrings.xml') ? descendants(memberXml(entries, 'xl/sharedStrings.xml', check), 'si').map((n) => descendants(n, 't').map(textOf).join('')) : [];
  const references = []; const sections = [];
  for (const sheet of descendants(workbook, 'sheet')) {
    check();
    const target = relationships.get(sheet.attrs['r:id']);
    const part = safeTarget('xl', target); const name = sheet.attrs.name ?? 'Unnamed sheet';
    const rows = [];
    const worksheet = memberXml(entries, part, check); assertRoot(worksheet, 'worksheet');
    for (const row of descendants(worksheet, 'row')) {
      if (rows.length >= 50_000) throw new Error('DOCUMENT_TABLE_ROW_LIMIT');
      const cells = []; let previous = -1;
      for (const c of children(row, 'c')) {
        const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(c.attrs.r ?? '');
        if (!match) throw new Error('XLSX_CELL_REFERENCE_INVALID');
        const column = [...match[1]].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;
        if (column >= 256 || column <= previous) throw new Error('XLSX_COLUMN_LIMIT_OR_ORDER');
        previous = column;
        const value = textOf(children(c, 'v')[0] ?? '');
        let rendered = value;
        if (c.attrs.t === 's') { if (!/^\d+$/.test(value) || Number(value) >= strings.length) throw new Error('XLSX_SHARED_STRING_INVALID'); rendered = strings[Number(value)]; }
        else if (c.attrs.t === 'inlineStr') rendered = descendants(c, 't').map(textOf).join('');
        else if (c.attrs.t === 'b') rendered = value === '1' ? 'TRUE' : value === '0' ? 'FALSE' : value;
        if (children(c, 'f').length && !children(c, 'v').length) rendered = '[formula has no cached value]';
        cells[column] = escape(rendered);
      }
      rows.push(cells);
    }
    sections.push(`## ${escape(name)}\n\n${table(rows)}`);
    references.push({ kind: 'sheet', name, part, rows: rows.length });
  }
  return { markdown: sections.join('\n\n'), references, metadata: { formulasEvaluated: false, stylesAndDateFormatting: 'NOT_SUPPORTED' } };
}
function presentation(entries, check) {
  const doc = memberXml(entries, 'ppt/presentation.xml', check);
  assertRoot(doc, 'presentation');
  const relationships = relationshipMap(entries, 'ppt/_rels/presentation.xml.rels', check);
  const sections = []; const references = [];
  for (const slide of descendants(doc, 'sldId')) {
    const part = safeTarget('ppt', relationships.get(slide.attrs['r:id']));
    const xml = memberXml(entries, part, check);
    assertRoot(xml, 'sld');
    const blocks = descendants(xml, 'p').map((p) => descendants(p, 't').map((t) => escape(textOf(t))).join('')).filter(Boolean);
    const index = sections.length + 1;
    sections.push(`## Slide ${index}\n\n${blocks.join('\n\n')}`);
    references.push({ kind: 'slide', index, part });
  }
  return { markdown: sections.join('\n\n'), references };
}

export function convertBytes(bytes, format, limits, check) {
  if (format === 'pdf') unsupported('PDF_UNSUPPORTED: safe native PDF decoding, font maps and stream filters are not implemented');
  if (['zip', 'docx', 'xlsx', 'pptx'].includes(format)) {
    const entries = readArchive(bytes, limits, check);
    // Relationships are inert data; explicitly disclose omitted external targets.
    let externalRelationships = 0;
    for (const [name, content] of entries) if (name.endsWith('.rels')) {
      externalRelationships += descendants(readXml(decodeText(content), check), 'Relationship')
        .filter((rel) => rel.attrs.TargetMode === 'External').length;
    }
    if (format !== 'zip') {
      assertRoot(memberXml(entries, '[Content_Types].xml', check), 'Types');
      const result = format === 'docx' ? word(entries, check) : format === 'xlsx' ? spreadsheet(entries, check) : presentation(entries, check);
      const properties = {};
      if (entries.has('docProps/core.xml')) {
        const core = memberXml(entries, 'docProps/core.xml', check);
        for (const key of ['title', 'subject', 'creator', 'description', 'language', 'created', 'modified']) {
          const node = descendants(core, key)[0]; if (node) properties[key] = textOf(node);
        }
      }
      return { ...result, metadata: { ...result.metadata, properties, externalRelationshipsIgnored: externalRelationships } };
    }
    const sections = []; const references = [];
    for (const [name, content] of entries) {
      check();
      if (name.endsWith('/')) continue;
      const ext = name.split('.').at(-1).toLowerCase();
      if (['zip', 'docx', 'xlsx', 'pptx', 'epub'].includes(ext)) throw new Error('ZIP_RECURSION_FORBIDDEN');
      if (!['txt', 'md', 'markdown', 'html', 'htm', 'csv', 'json', 'xml'].includes(ext)) {
        references.push({ kind: 'archive-member', name, status: 'UNSUPPORTED' }); continue;
      }
      const converted = convertBytes(content, detectFormat(content, name), limits, check);
      sections.push(`## ${escape(name)}\n\n${converted.markdown}`);
      references.push({ kind: 'archive-member', name, bytes: content.length });
    }
    return { markdown: sections.join('\n\n'), references, metadata: { members: entries.size, nestedArchives: false } };
  }
  const text = decodeText(bytes);
  const references = [{ kind: 'lines', start: 1, end: text ? text.split('\n').length : 0 }];
  if (format === 'txt' || format === 'md') return { markdown: text, references };
  if (format === 'html') return { markdown: html(text, check), references };
  if (format === 'csv') return { markdown: table(parseDelimitedRows(text, ',', check)), references };
  if (format === 'json') return { markdown: `\`\`\`json\n${JSON.stringify(JSON.parse(text), null, 2)}\n\`\`\``, references };
  if (format === 'xml') {
    readXml(text, check);
    return { markdown: `\`\`\`xml\n${text}\n\`\`\``, references };
  }
  unsupported('DOCUMENT_FORMAT_UNSUPPORTED');
}
