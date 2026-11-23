import * as path from 'path';
export { OdooManifestExtractor } from './odoo-manifest-extractor';
export { OdooAccessCsvExtractor } from './odoo-access-csv-extractor';
export { OdooSecurityXmlExtractor } from './odoo-security-xml-extractor';

/**
 * Checks whether a file path points to an Odoo module manifest.
 */
export function isOdooManifest(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base === '__manifest__.py' || base === '__openerp__.py';
}

/**
 * Checks whether a file path points to an Odoo access control list CSV file.
 * Matches `ir.model.access.csv`, `ir.model.access.*.csv`, or any CSV inside a `security/` folder.
 */
export function isOdooAccessCsv(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const base = path.basename(normalized);
  if (base === 'ir.model.access.csv' || /^ir\.model\.access[\w.-]*\.csv$/.test(base)) {
    return true;
  }
  if (/(?:^|\/)security\/[^/]+\.csv$/.test(normalized)) {
    return true;
  }
  return false;
}

/**
 * Checks whether XML source text represents Odoo XML data.
 * Checks for `<odoo>`, `<openerp>`, or record tags targeting Odoo security models.
 */
export function isOdooXml(source: string, filePath?: string): boolean {
  if (filePath) {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase();
    if (/(?:^|\/)security\/[^/]+\.xml$/.test(normalized)) {
      return true;
    }
  }
  // Check the first 4KB for Odoo markers
  const sample = source.slice(0, 4096);
  if (/<(?:odoo|openerp)\b/i.test(sample)) {
    return true;
  }
  if (/<record\b[^>]*\bmodel\s*=\s*["'](?:ir\.rule|res\.groups|ir\.model\.access)\b/i.test(sample)) {
    return true;
  }
  return false;
}

