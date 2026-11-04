import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src');
const target = path.join(root, 'dist');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
  fs.copyFileSync(path.join(source, entry.name), path.join(target, entry.name));
}
fs.chmodSync(path.join(target, 'cli.js'), 0o755);
process.stdout.write(`Built ${fs.readdirSync(target).length} ACE runtime files.\n`);
