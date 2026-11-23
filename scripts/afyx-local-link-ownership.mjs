/** Read-only guard for the existing local npm link lifecycle. */
import { lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function inspectLocalLink(repositoryRoot, globalModules) {
  const repository = realpathSync(repositoryRoot), entry = join(resolve(globalModules), 'afyx-engineering-kit');
  try {
    const stat = lstatSync(entry);
    return { status: stat.isSymbolicLink() && realpathSync(entry) === repository ? 'OWNED_LINK' : 'FOREIGN_INSTALLATION', entry };
  } catch (error) { if (error.code === 'ENOENT') return { status: 'NOT_INSTALLED', entry }; return { status: 'UNVERIFIED', entry }; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectLocalLink(process.argv[2], process.argv[3]);
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!['OWNED_LINK', 'NOT_INSTALLED'].includes(result.status)) process.exitCode = 1;
}
