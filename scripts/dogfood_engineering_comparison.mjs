/**
 * Diagnostik lokal untuk pilot AFYX-309. Pengukuran mencakup operasi skrip,
 * bukan sesi agent. Untuk perbandingan OFF/ON gunakan Phase 8 paired intake.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const models = 'addons/enterprise_sales_order_management_v17_module/models';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const elapsed = start => Number((performance.now() - start).toFixed(3));

export function parseInventoryCount(output) {
  const lines = output.split(/\r?\n/).filter(line => /^(?:\*\*)?Matches:/.test(line));
  if (lines.length !== 1) return null;
  const match = /^(?:\*\*Matches:\*\*|Matches:) (\d+) declarations(?:; \d+ files; \d+ modules)?$/.exec(lines[0]);
  const count = Number(match?.[1]);
  return Number.isSafeInteger(count) ? count : null;
}

export function inventoryObservation({ status, stdout }, durationMs) {
  const bytes = status === 0 && Buffer.isBuffer(stdout) ? stdout : null;
  const count = bytes ? parseInventoryCount(bytes.toString('utf8')) : null;
  return {
    durationMs,
    stdoutBytes: bytes?.length ?? null,
    stdoutSha256: bytes ? sha256(bytes) : null,
    reportedDeclarationCount: count,
    countAvailability: count === null ? 'NOT_AVAILABLE' : 'OBSERVED_PARTIAL',
    accuracy: null,
  };
}

function runDiagnostic(pilotRoot) {
  const project = path.join(pilotRoot, 'test-data', 'sample-project');
  const start = performance.now();
  const inputs = fs.readdirSync(path.join(project, models), { withFileTypes:true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.py'))
    .map(entry => fs.readFileSync(path.join(project, models, entry.name)));
  const readDurationMs = elapsed(start);
  const graph = path.join(pilotRoot, 'install-root', 'graph', 'current', 'lib', 'dist', 'bin', 'afyx-graph.js');
  const queryStart = performance.now();
  const query = spawnSync(process.execPath, [graph, 'inventory', '-p', project, '--scope', models, '_inherit', 'sale.order'],
    { timeout:30000, maxBuffer:1024 * 1024, windowsHide:true });
  return {
    contract:'AfyxDogfoodEngineeringComparison/v2',
    evidenceStatus:'OBSERVED_PARTIAL',
    sourceRevision:null,
    providerTokens:null,
    tokenSavings:null,
    agentToolCalls:null,
    comparison:null,
    directScan:{
      readDurationMs,
      sourceBytesRead:inputs.reduce((total, bytes) => total + bytes.length, 0),
      filesRead:inputs.length,
      regexOccurrences:inputs.reduce((total, bytes) =>
        total + (bytes.toString('utf8').match(/_inherit\s*=\s*['"]sale\.order['"]/g)?.length ?? 0), 0),
      accuracy:null,
    },
    graphInventory:inventoryObservation(query, elapsed(queryStart)),
    limitations:[
      'Byte sumber dibaca dan byte stdout Graph mengukur dua batas yang berbeda.',
      'Hitungan regex dan deklarasi Graph belum dibandingkan dengan oracle.',
      'Identitas revisi sumber proyek dan metrik sesi agent belum tersedia.',
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--pilot-root') {
    process.stderr.write('Penggunaan: node scripts/dogfood_engineering_comparison.mjs --pilot-root <direktori-pilot>\n');
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(runDiagnostic(path.resolve(process.argv[3])), null, 2)); }
    catch { process.stderr.write('Diagnostik lokal tidak tersedia. Periksa direktori pilot.\n'); process.exitCode = 1; }
  }
}
