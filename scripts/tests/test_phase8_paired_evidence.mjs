import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../phase8-paired-evidence.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const at = n => new Date(Date.UTC(2026,9,31,0,0,n)).toISOString();
const fake = 'a'.repeat(64);
function setup(t, evidenceClass = 'owner_observed', usage = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-intake-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const runs = ['OFF','ON'].map((mode,index) => {
    const runId = 'paired-' + mode.toLowerCase();
    const events = [
      {id:mode+'0',kind:'start',at:at(0),runId},
      {id:mode+'1',kind:'tool_call',actor:'agent',at:at(1),runId},
      ...(usage ? [{id:mode+'2',kind:'provider_usage',source:'provider_report',
        usageSemantics:'per_turn_delta',inputTokens:100 + index*10,cachedInputTokens:20,outputTokens:30,at:at(2),runId}] : []),
      {id:mode+'3',kind:'end',at:at(4+index),runId},
    ];
    const bytes = events.map(v => JSON.stringify(v)).join('\n') + '\n';
    const eventsFile = mode.toLowerCase()+'.ndjson';
    fs.writeFileSync(path.join(dir,eventsFile),bytes);
    return {mode,runId,eventsFile,eventsSha256:sha(bytes),
      quality:{correctness:'PASS',tests:'PASS',security:'PASS',evaluatorReceiptSha256:'b'.repeat(64)},
      coverage:{toolEvents:true,humanEvents:false,reworkEvents:false,providerUsage:usage},
      timing:{capture:'LIVE_MONITORED',liveReceiptSha256:'f'.repeat(64)}};
  });
  const manifest = {contract:'afyx.phase8.paired-evidence/v1',evidenceClass,
    caseId:'synthetic-contract-case',taskSha256:fake,sourceRevision:'c'.repeat(40),
    oracleSha256:fake,permissionsSha256:fake,environmentSha256:fake,
    model:'synthetic-model-only',effort:'medium',runs};
  const file = path.join(dir,'manifest.json');
  const save = () => fs.writeFileSync(file,JSON.stringify(manifest));
  save();
  return {dir,file,manifest,save};
}
test('paired metrics are derived from hashed events, not estimated', t => {
  const f=setup(t),r=loadManifest(f.file);
  assert.equal(r.verdict,'ELIGIBLE_FOR_INDEPENDENT_REVIEW');
  assert.equal(r.independentAcceptance,'NOT_VERIFIED');
  assert.equal(r.comparativeMetrics.wallMs.deltaOnMinusOff,1000);
  assert.equal(r.comparativeMetrics.inputTokens.deltaOnMinusOff,10);
  assert.equal(r.comparativeMetrics.toolCalls.on,1);
  assert.equal(r.comparativeMetrics.humanInterventions.off,null);
  assert.equal(r.comparativeMetrics.humanInterventions.percentOnMinusOff,null);
  assert.ok(r.warnings.some(v => v.includes('humanEvents')));
  assert.ok(!JSON.stringify(r).includes('paired-off'));
  assert.ok(!JSON.stringify(r).includes('eventsFile'));
});
test('synthetic results cannot become independent real-workload acceptance', t => {
  const f=setup(t,'synthetic_fixture');
  assert.equal(loadManifest(f.file).verdict,'SYNTHETIC_ONLY');
});
test('missing provider token events are not zero-imputed', t => {
  const f=setup(t,'owner_observed',false),r=loadManifest(f.file);
  assert.equal(r.comparativeMetrics.inputTokens.off,null);
  assert.equal(r.comparativeMetrics.outputTokens.deltaOnMinusOff,null);
});
test('security and correctness are hard gates even if ON uses fewer resources', t => {
  const f=setup(t);
  f.manifest.runs[1].quality.security='FAIL';f.save();
  assert.equal(loadManifest(f.file).verdict,'HARD_GATE_FAILED');
  const cli=fileURLToPath(new URL('../phase8-paired-evidence.mjs',import.meta.url));
  const p=spawnSync(process.execPath,[cli,'--input',f.file],{encoding:'utf8'});
  assert.equal(p.status,1);
});
test('NOT_RUN quality blocks review eligibility', t => {
  const f=setup(t);
  f.manifest.runs[0].quality.correctness='NOT_RUN';f.save();
  assert.equal(loadManifest(f.file).verdict,'QUALITY_EVIDENCE_INCOMPLETE');
});
test('tampered raw evidence rejects without echoing raw contents', t => {
  const f=setup(t);
  fs.appendFileSync(path.join(f.dir,'off.ndjson'),'PRIVATE CUSTOMER CODE');
  assert.throws(() => loadManifest(f.file),/SHA256 mismatch/);
  const cli=fileURLToPath(new URL('../phase8-paired-evidence.mjs',import.meta.url));
  const p=spawnSync(process.execPath,[cli,'--input',f.file],{encoding:'utf8'});
  assert.equal(p.status,2);
  assert.ok(!(p.stdout+p.stderr).includes('PRIVATE CUSTOMER CODE'));
});
test('rejects traversal and symlinked trace files', t => {
  const f=setup(t);
  f.manifest.runs[0].eventsFile='../outside.ndjson';f.save();
  assert.throws(() => loadManifest(f.file),/traversal/);
  try {fs.symlinkSync(path.join(f.dir,'off.ndjson'),path.join(f.dir,'link.ndjson'));}
  catch {return;} // Symlink creation may require a Windows privilege.
  f.manifest.runs[0].eventsFile='link.ndjson';f.save();
  assert.throws(() => loadManifest(f.file),/symlink/);
});
test('false complete usage flags fail closed', t => {
  const f=setup(t,'owner_observed',false);
  f.manifest.runs[0].coverage.providerUsage=true;f.save();
  assert.throws(() => loadManifest(f.file),/without usage/);
});
test('human actor identity must be observed, not inferred from calls', t => {
  const f=setup(t),file=path.join(f.dir,'off.ndjson');
  const events=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
  events[1].actor='human';
  const bytes=events.map(v=>JSON.stringify(v)).join('\n')+'\n';
  fs.writeFileSync(file,bytes);f.manifest.runs[0].eventsSha256=sha(bytes);f.save();
  assert.throws(() => loadManifest(f.file),/agent actor/);
});
test('paired control identity cannot be absent or duplicated', t => {
  const f=setup(t);
  delete f.manifest.sourceRevision;f.save();
  assert.throws(() => loadManifest(f.file),/missing sourceRevision/);
  f.manifest.sourceRevision='c'.repeat(40);
  f.manifest.runs[1].mode='OFF';f.save();
  assert.throws(() => loadManifest(f.file),/ordered OFF and ON/);
});

test('unverified or replayed timing cannot claim agent wall duration', t => {
  const f=setup(t);
  f.manifest.runs.forEach(run => {run.timing={capture:'REPLAY_OR_UNVERIFIED',liveReceiptSha256:null};});
  f.save();
  const report=loadManifest(f.file);
  assert.equal(report.comparativeMetrics.wallMs.off,null);
  assert.equal(report.comparativeMetrics.wallMs.on,null);
  assert.equal(report.comparativeMetrics.wallMs.status,'NOT_AVAILABLE');
  f.manifest.runs[1].timing={capture:'LIVE_MONITORED',liveReceiptSha256:null};
  f.save();
  assert.throws(() => loadManifest(f.file), /live timing requires external receipt digest/);
});
test('cumulative provider counters are rejected instead of double counted', t => {
  const f=setup(t);
  const filename=path.join(f.dir,'off.ndjson');
  const events=fs.readFileSync(filename,'utf8').trim().split('\n').map(JSON.parse);
  events[2].usageSemantics='cumulative_snapshot';
  const raw=events.map(e=>JSON.stringify(e)).join('\n')+'\n';
  fs.writeFileSync(filename,raw);
  f.manifest.runs[0].eventsSha256=sha(raw);
  f.save();
  assert.throws(() => loadManifest(f.file), /cumulative usage snapshots/);
});
test('malformed private manifest contents must not leak into CLI error output', t => {
  const f=setup(t), secret='PRIVATE-DO-NOT-ECHO';
  fs.writeFileSync(f.file,'{"customerSecret":"'+secret+'" INVALID}');
  const cli=fileURLToPath(new URL('../phase8-paired-evidence.mjs',import.meta.url));
  const p=spawnSync(process.execPath,[cli,'--input',f.file],{encoding:'utf8'});
  assert.equal(p.status,2);
  assert.ok(!(p.stderr+p.stdout).includes(secret));
  assert.ok(p.stderr.includes('manifest JSON invalid'));
});
