#!/usr/bin/env node
/** Safe global routing instructions for registered providers. No provider or model invocation. */
import { existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const registry = JSON.parse(readFileSync(fileURLToPath(new URL('./components.json', import.meta.url)), 'utf8'));
const SUPPORTED = Object.freeze(registry.providers.map(p => p.provider));
const DEFAULT_POLICY = fileURLToPath(new URL('./afyx-global-routing-policy.md', import.meta.url));
const START = '<!-- AFYX-ADAPTIVE-ROUTING:START v1 -->';
const END = '<!-- AFYX-ADAPTIVE-ROUTING:END v1 -->';
const LEGACY_NAME = ['code', 'graph'].join('');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function safeTarget(root, file) {
  if (dirname(file) !== root) throw Error('PATH_OUTSIDE_PROVIDER_ROOT');
  let cursor = file;
  for (;;) {
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) throw Error('SYMLINK_OR_REPARSE_BLOCKED');
    // The provider root is the caller-authorized boundary. macOS may have
    // legitimate system symlinks above it (e.g. /var -> /private/var).
    if (cursor === root) break;
    const parent = dirname(cursor);
    if (parent === cursor) throw Error('PATH_OUTSIDE_PROVIDER_ROOT');
    cursor = parent;
  }
}
export function providerTargets({home = homedir(), codexHome, geminiHome, claudeHome} = {}) {
  function rooted(value, fallback) {
    const path = value ?? fallback;
    if (typeof path !== 'string' || !isAbsolute(path)) throw Error('GLOBAL_ROOT_MUST_BE_ABSOLUTE');
    return resolve(path);
  }
  const base = rooted(home, homedir());
  const codex = rooted(codexHome ?? process.env.CODEX_HOME, join(base, '.codex'));
  const gemini = rooted(geminiHome, join(base, '.gemini'));
  const claude = rooted(claudeHome ?? process.env.CLAUDE_CONFIG_DIR, join(base, '.claude'));
  const override = join(codex, 'AGENTS.override.md');
  safeTarget(codex, override);
  return Object.freeze({
    codex: {root: codex, file: existsSync(override) && readFileSync(override).length ? override : join(codex, 'AGENTS.md')},
    antigravity: {root: gemini, file: join(gemini, 'GEMINI.md')},
    claude: {root: claude, file: join(claude, 'CLAUDE.md')},
  });
}
function inspectFile(file, policy) {
  const bytes = existsSync(file) ? readFileSync(file) : null;
  let data = '';
  if (bytes !== null) {
    try { data = decoder.decode(bytes); }
    catch { return {status:'BLOCKED_ENCODING', bytes, data:''}; }
  }
  const start = data.indexOf(START), end = data.indexOf(END);
  if ((start < 0) !== (end < 0) ||
      (start >= 0 && (start > end || data.lastIndexOf(START) !== start || data.lastIndexOf(END) !== end))) {
    return {status:'BLOCKED_MARKER', bytes, data};
  }
  const owned = start >= 0;
  const outside = owned ? data.slice(0,start) + data.slice(end + END.length) : data;
  const legacy = new RegExp('\\b' + LEGACY_NAME + '\\b','iu');
  const conflictLines = outside.split(/\r?\n/u)
    .flatMap((line, n) => legacy.test(line) &&
      /\b(must|always|before|first|prefer|required|mandatory|wajib|harus|priorit)/iu.test(line)
      ? [n+1] : []);
  if (conflictLines.length) return {status:'BLOCKED_CONFLICT', bytes, data, conflictLines};
  const wanted = START + '\n' + policy.trim() + '\n' + END;
  if (!owned) return {status:bytes === null ? 'MISSING' : 'UNMANAGED', bytes, data, wanted};
  const current = data.slice(start,end+END.length);
  return {status:current.replace(/\r\n/gu,'\n') === wanted ? 'IN_SYNC' : 'DRIFTED_OWNED',
    bytes, data, wanted, start, end};
}
function writeBlock(item) {
  const eol = item.data.includes('\r\n') ? '\r\n' : '\n';
  const wanted = item.wanted.replace(/\n/gu,eol);
  if (item.start !== undefined) {
    return Buffer.from(item.data.slice(0,item.start)+wanted+item.data.slice(item.end+END.length),'utf8');
  }
  return Buffer.from(item.data + (item.data && !item.data.endsWith('\n') ? eol : '') + wanted + eol,'utf8');
}
function removeBlock(item) {
  if (item.start === undefined) throw Error('OWNED_BLOCK_NOT_FOUND');
  const prefix = item.data.slice(0,item.start);
  const suffix = item.data.slice(item.end+END.length);
  return Buffer.from(prefix + suffix.replace(/^\r?\n/u,''),'utf8');
}
function backupOriginal(root, file, before) {
  if (before === null) return;
  const dir = join(root,'.afyx-global-routing-backups');
  safeTarget(root,dir);
  mkdirSync(dir,{recursive:true,mode:0o700});
  if(lstatSync(dir).isSymbolicLink()) throw Error('UNSAFE_BACKUP_DIRECTORY');
  const path = join(dir,basename(file)+'.'+sha(before)+'.'+Date.now()+'.bak');
  let fd;
  try { fd = openSync(path,'wx',0o600); writeFileSync(fd,before); }
  finally { if(fd!==undefined) closeSync(fd); }
}
function atomicWrite(file, bytes) {
  mkdirSync(dirname(file),{recursive:true});
  const temp = file+'.afyx-'+process.pid+'-'+Date.now()+'.tmp';
  try { writeFileSync(temp,bytes,{flag:'wx',mode:0o600}); renameSync(temp,file); }
  finally { rmSync(temp,{force:true}); }
}
export function runGlobalRouting({operation='plan',providers=SUPPORTED,
    policyFile=DEFAULT_POLICY,roots={},apply=false} = {}) {
  if(!['plan','apply','verify','uninstall'].includes(operation)) throw Error('INVALID_OPERATION');
  if(!Array.isArray(providers) || !providers.length ||
      providers.some(p=>!SUPPORTED.includes(p))) throw Error('UNSUPPORTED_PROVIDER');
  if((operation==='apply'||operation==='uninstall')&&!apply) throw Error('EXPLICIT_APPLY_REQUIRED');
  const targets = providerTargets(roots);
  const policy = readFileSync(policyFile,'utf8').replace(/\r\n/gu,'\n');
  if (!policy.includes('Afyx adaptive tool routing') || policy.trim().length<100) throw Error('INVALID_POLICY');
  const inspected = [...new Set(providers)].map(provider => {
    const target=targets[provider];
    if(!target) throw Error('PROVIDER_TARGET_UNSUPPORTED');
    safeTarget(target.root,target.file);
    return {provider,...target,...inspectFile(target.file,policy)};
  });
  const summary = inspected.map(({provider,file,status,conflictLines}) =>
    ({provider,path:file,status,conflictLines:conflictLines??[]}));
  const blocked=inspected.some(i=>i.status.startsWith('BLOCKED'));
  if(blocked) return {status:'BLOCKED',changed:false,providers:summary};
  if(operation==='plan'||operation==='verify') return {status:'READ_ONLY',changed:false,providers:summary};
  const changed=[];
  try {
    for(const item of inspected) {
      if(operation==='apply' && item.status==='IN_SYNC') continue;
      if(operation==='uninstall' && !['IN_SYNC','DRIFTED_OWNED'].includes(item.status)) continue;
      if(operation==='apply' && !['MISSING','UNMANAGED','DRIFTED_OWNED'].includes(item.status)) throw Error('UNSAFE_STATE');
      if(item.bytes!==null && sha(readFileSync(item.file))!==sha(item.bytes)) throw Error('CONCURRENT_OWNER_EDIT');
      const next = operation==='apply'?writeBlock(item):removeBlock(item);
      if(item.bytes!==null && sha(next)===sha(item.bytes)) continue;
      backupOriginal(item.root,item.file,item.bytes);
      atomicWrite(item.file,next);
      changed.push({file:item.file,before:item.bytes,after:sha(next)});
    }
  } catch(error) {
    let recovered=true;
    for(const item of changed.reverse()) {
      try {
        if(sha(readFileSync(item.file))!==item.after){recovered=false;continue;}
        if(item.before===null)rmSync(item.file,{force:true});
        else atomicWrite(item.file,item.before);
      } catch { recovered=false; }
    }
    return {status:recovered?'ROLLED_BACK':'ROLLBACK_INCOMPLETE',changed:!recovered,
      reason:String(error.message),providers:summary};
  }
  return {status:'APPLIED',changed:changed.length>0,
    providers:summary.map(v=>({...v,postState:operation==='apply'?'IN_SYNC':'UNMANAGED_OR_ABSENT'}))};
}
function argument(name){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:undefined;}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const operation=process.argv.includes('--uninstall')?'uninstall':
      process.argv.includes('--verify')?'verify':process.argv.includes('--apply')?'apply':'plan';
    const raw=argument('--providers');
    const providers=raw?raw.split(',').map(s=>s.trim()):SUPPORTED;
    const result=runGlobalRouting({operation,apply:process.argv.includes('--apply'),providers,
      roots:{codexHome:argument('--codex-home'),geminiHome:argument('--gemini-home'),
        claudeHome:argument('--claude-home')}});
    console.log(JSON.stringify(result,null,2));
    if(['BLOCKED','ROLLED_BACK','ROLLBACK_INCOMPLETE'].includes(result.status))process.exitCode=2;
  }catch(error){console.error(JSON.stringify({status:'BLOCKED',reason:error.message}));process.exitCode=2;}
}
