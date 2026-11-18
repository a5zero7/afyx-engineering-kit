/** Bounded XML data reader: entities, DTD, external resources and processing code are never loaded. */
export function readXml(text, check = () => {}) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML_DTD_FORBIDDEN');
  const root = { name: '#document', attrs: {}, children: [] };
  const stack = [root];
  let offset = 0; let nodes = 0;
  const append = (value) => { stack.at(-1).children.push(value); };
  while (offset < text.length) {
    check();
    if (++nodes > 100_000) throw new Error('XML_NODE_LIMIT');
    if (text[offset] !== '<') {
      const end = text.indexOf('<', offset);
      append(entity(text.slice(offset, end < 0 ? text.length : end)));
      offset = end < 0 ? text.length : end;
      continue;
    }
    if (text.startsWith('<!--', offset)) {
      const end = text.indexOf('-->', offset + 4);
      if (end < 0 || text.slice(offset + 4, end).includes('--')) throw new Error('XML_COMMENT_INVALID');
      offset = end + 3; continue;
    }
    if (text.startsWith('<![CDATA[', offset)) {
      const end = text.indexOf(']]>', offset + 9);
      if (end < 0) throw new Error('XML_CDATA_INVALID');
      append(text.slice(offset + 9, end)); offset = end + 3; continue;
    }
    if (text.startsWith('<?xml', offset) && offset === 0) {
      const end = text.indexOf('?>', offset);
      if (end < 0) throw new Error('XML_DECLARATION_INVALID');
      offset = end + 2; continue;
    }
    const token = /^<(\/?)([A-Za-z_][\w.:-]*)(\s[^<>]*?|\s*)(\/?)>/.exec(text.slice(offset));
    if (!token) throw new Error('XML_MALFORMED');
    offset += token[0].length;
    if (token[1]) {
      if (token[3].trim() || token[4] || stack.length === 1 || stack.at(-1).name !== token[2]) throw new Error('XML_UNBALANCED');
      stack.pop(); continue;
    }
    const attrs = Object.create(null);
    let remaining = token[3].trim();
    while (remaining) {
      const attribute = /^([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/.exec(remaining);
      if (!attribute || Object.hasOwn(attrs, attribute[1])) throw new Error('XML_ATTRIBUTE_INVALID');
      attrs[attribute[1]] = entity(attribute[2] ?? attribute[3]);
      remaining = remaining.slice(attribute[0].length);
    }
    const node = { name: token[2], attrs, children: [] };
    append(node);
    if (!token[4]) stack.push(node);
    if (stack.length > 128) throw new Error('XML_DEPTH_LIMIT');
  }
  if (stack.length !== 1 || root.children.filter((n) => typeof n !== 'string').length !== 1
    || root.children.some((n) => typeof n === 'string' && n.trim())) throw new Error('XML_ROOT_INVALID');
  return root;
}

export function entity(text) {
  return text.replace(/&([^;\s]+);|&/g, (all, value) => {
    const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(known, value)) return known[value];
    if (/^#(?:x[\da-f]+|\d+)$/i.test(value || '')) {
      const code = value[1]?.toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1));
      if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff))) return String.fromCodePoint(code);
    }
    throw new Error('XML_ENTITY_INVALID');
  });
}
export const localName = (node) => typeof node === 'string' ? '' : node.name.split(':').at(-1);
export const children = (node, name) => node.children.filter((n) => typeof n !== 'string' && (!name || localName(n) === name));
export function descendants(node, name) {
  const result = [];
  for (const child of node.children) if (typeof child !== 'string') {
    if (localName(child) === name) result.push(child);
    result.push(...descendants(child, name));
  }
  return result;
}
export const textOf = (node) => typeof node === 'string' ? node : node.children.map(textOf).join('');
