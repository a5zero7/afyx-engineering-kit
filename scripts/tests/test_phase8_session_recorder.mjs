import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadManifest } from '../phase8-paired-evidence.mjs';

const script = fileURLToPath(new URL('../phase8-session-recorder.mjs',import.meta.url));
const sha = input => createHash('sha256').update(input).digest('hex');
function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'afyx-paired-recorder-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}
function run(root, mode, events, extra=[]) {
  const input=events.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n')+'\n';
  return spawnSync(process.execPath,[script,'--mode',mode,'--root',root,'--run-id','fixture-'+mode.toLowerCase(),...extra],{
    input,encoding:'utf8',timeout:10000,maxBuffer:400000,
  });
}
const TOOL={kind:'tool_call',actor:'agent'};
const USAGE={kind:'provider_usage',source:'provider_report',usageSemantics:'per_turn_delta',inputTokens:117,cachedInputTokens:17,outputTokens:23};
test('real typed stream materializes a hash-checked private run descriptor',t=>{
  const dir=setup(t);
  const p=run(dir,'OFF',[TOOL,USAGE]);
  assert.equal(p.status,0,p.stderr);
  const d=JSON.parse(p.stdout);
  assert.equal(d.contract,'afyx.phase8.local-capture/v1');
  assert.equal(d.declaredCoverage,'ALL_UNVERIFIED');
  assert.deepEqual(d.run.coverage,{toolEvents:false,humanEvents:false,reworkEvents:false,providerUsage:false});
  assert.equal(d.run.quality.correctness,'NOT_RUN');
  assert.deepEqual(d.run.timing,{capture:'REPLAY_OR_UNVERIFIED',liveReceiptSha256:null});
  const bytes=fs.readFileSync(path.join(dir,'off.ndjson'));
  assert.equal(d.run.eventsSha256,sha(bytes));
  const rows=bytes.toString('utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(x=>x.kind),['start','tool_call','provider_usage','end']);
  assert.deepEqual(rows.map(x=>x.id),['evt-0','evt-1','evt-2','evt-3']);
  assert.ok(rows.every(x=>x.runId==='fixture-off'));
  assert.equal(rows[2].inputTokens,117);
  assert.ok(!p.stdout.includes('"inputTokens"'));
  assert.ok(!p.stdout.includes('"tool_call"'));
});
test('recorded OFF/ON streams are accepted by paired verifier without declaring phantom coverage',t=>{
  const root=setup(t);
  const off=JSON.parse(run(root,'OFF',[TOOL]).stdout).run;
  const on=JSON.parse(run(root,'ON',[TOOL,TOOL]).stdout).run;
  const manifest={contract:'afyx.phase8.paired-evidence/v1',evidenceClass:'synthetic_fixture',
    caseId:'ci-recorder-contract',taskSha256:'a'.repeat(64),oracleSha256:'b'.repeat(64),
    permissionsSha256:'c'.repeat(64),environmentSha256:'d'.repeat(64),
    sourceRevision:'e'.repeat(40),model:'ci-stub',effort:'medium',runs:[off,on]};
  const file=path.join(root,'manifest.json');
  fs.writeFileSync(file,JSON.stringify(manifest));
  let report=loadManifest(file);
  assert.equal(report.verdict,'SYNTHETIC_ONLY');
  assert.equal(report.comparativeMetrics.toolCalls.off,null);
  assert.equal(report.comparativeMetrics.inputTokens.on,null);
  assert.equal(report.comparativeMetrics.wallMs.on,null);
  assert.equal(report.independentAcceptance,'NOT_VERIFIED');
  manifest.runs.forEach(x=>{x.coverage.toolEvents=true;});
  fs.writeFileSync(file,JSON.stringify(manifest));
  report=loadManifest(file);
  assert.equal(report.comparativeMetrics.toolCalls.deltaOnMinusOff,1);
  assert.equal(report.comparativeMetrics.humanInterventions.off,null);
  assert.equal(report.verdict,'SYNTHETIC_ONLY');
});
test('rejects free-text or raw customer data and removes incomplete evidence',t=>{
  const root=setup(t),secret='SECRET-IN-PRIVATE-TOOL-PAYLOAD';
  const p=run(root,'ON',[{kind:'tool_call',actor:'agent',prompt:secret}]);
  assert.equal(p.status,2);
  assert.ok(!(p.stdout+p.stderr).includes(secret));
  assert.equal(fs.existsSync(path.join(root,'on.ndjson')),false);
});
test('invalid input JSON does not leak the malformed text',t=>{
  const root=setup(t),p=run(root,'OFF',['{"kind":"CUSTOMER-SECRET']);
  assert.equal(p.status,2);
  assert.match(p.stderr,/invalid telemetry JSON/);
  assert.ok(!p.stderr.includes('CUSTOMER-SECRET'));
  assert.equal(fs.existsSync(path.join(root,'off.ndjson')),false);
});
test('human intervention requires explicit human actor; agent retries are not human',t=>{
  const root=setup(t);
  const p=run(root,'ON',[{kind:'human_intervention',actor:'agent'}]);
  assert.equal(p.status,2);
  assert.equal(fs.existsSync(path.join(root,'on.ndjson')),false);
});
test('rejects invalid provider usage counters and source',t=>{
  const root=setup(t);
  assert.equal(run(root,'OFF',[{...USAGE,source:'estimated'}]).status,2);
  assert.equal(run(root,'OFF',[{...USAGE,usageSemantics:'cumulative_snapshot'}]).status,2);
  assert.equal(run(root,'OFF',[{...USAGE,cachedInputTokens:118}]).status,2);
  assert.equal(run(root,'OFF',[{...USAGE,inputTokens:-1}]).status,2);
  assert.equal(fs.existsSync(path.join(root,'off.ndjson')),false);
});
test('refuses to overwrite prior run evidence',t=>{
  const root=setup(t);
  const first=run(root,'OFF',[TOOL]);
  assert.equal(first.status,0,first.stderr);
  const bytes=fs.readFileSync(path.join(root,'off.ndjson'));
  const second=run(root,'OFF',[TOOL]);
  assert.equal(second.status,2);
  assert.deepEqual(fs.readFileSync(path.join(root,'off.ndjson')),bytes);
});
test('rejects evidence destination inside source workspace',t=>{
  const root=setup(t),app=path.join(root,'app'),capture=path.join(app,'private');
  fs.mkdirSync(capture,{recursive:true});
  const p=run(capture,'ON',[TOOL],['--workspace-root',app]);
  assert.equal(p.status,2);
  assert.equal(fs.existsSync(path.join(capture,'on.ndjson')),false);
});
test('refuses invalid mode, unknown options and invalid run IDs',t=>{
  const root=setup(t);
  assert.equal(run(root,'OTHER',[TOOL]).status,2);
  assert.equal(run(root,'OFF',[TOOL],['--unapproved','anything']).status,2);
  assert.equal(run(root,'OFF',[TOOL],['--run-id','../escape']).status,2);
  assert.equal(fs.existsSync(path.join(root,'off.ndjson')),false);
});
test('empty observed event stream does not imply complete observation',t=>{
  const root=setup(t),p=run(root,'ON',[]);
  assert.equal(p.status,0,p.stderr);
  const data=JSON.parse(p.stdout);
  assert.equal(data.capturedEvents,0);
  assert.equal(data.run.coverage.humanEvents,false);
  assert.equal(data.run.coverage.toolEvents,false);
  const rows=fs.readFileSync(path.join(root,'on.ndjson'),'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(e=>e.kind),['start','end']);
});
