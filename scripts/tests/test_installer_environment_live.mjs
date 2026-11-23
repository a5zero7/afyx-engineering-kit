import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { PACKAGE_ROOT } from '../afyx-npm-installer.mjs';

const windows = process.platform === 'win32';
for (const shell of windows ? ['powershell.exe', 'pwsh.exe', 'cmd.exe'] : ['bash', 'zsh']) {
  test(`real ${shell} parent is identified independently of login-shell hints`, { timeout: 20_000 }, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'afyx-environment-live-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const probe = join(root, 'observe.mjs');
    writeFileSync(probe, `import {detectInstallerEnvironment} from ${JSON.stringify(new URL('../afyx-installer-environment.mjs', import.meta.url).href)};\n` +
      `import {execFile} from 'node:child_process'; import {promisify} from 'node:util'; const execute=promisify(execFile);\n` +
      `const state=await detectInstallerEnvironment({pkgRoot:${JSON.stringify(PACKAGE_ROOT)},executeCommand:async(program,args,{signal}={})=>{const start=performance.now();try{return (await execute(program,args,{encoding:'utf8',timeout:4000,maxBuffer:32768,windowsHide:true,signal})).stdout.trim();}catch(error){console.error('AFYX_ENVIRONMENT_OBSERVATION '+JSON.stringify({program,elapsedMs:Math.round(performance.now()-start),code:error.code,signal:error.signal,killed:error.killed}));throw error;}}});\n` +
      `if(process.platform==='darwin'&&state.invokingShell.name==='Unknown'){const {execFileSync}=await import('node:child_process');for(const [program,args] of [['/bin/ps',['-p',String(process.ppid),'-o','ppid=','-o','comm=']],['/usr/sbin/lsof',['-a','-p',String(process.ppid),'-d','txt','-Fn']]]){try{console.error('AFYX_PARENT_OBSERVATION '+JSON.stringify({program,output:execFileSync(program,args,{encoding:'utf8',timeout:4000,maxBuffer:32768})}));}catch(error){console.error('AFYX_PARENT_OBSERVATION '+JSON.stringify({program,code:error.code}));}}}\n` +
      `console.log('AFYX_ENVIRONMENT_JSON '+JSON.stringify(state));\n`);
    let args, input;
    if (shell === 'cmd.exe') {
      assert.doesNotMatch(process.execPath + probe, /["%\r\n]/);
      args = ['/d', '/q']; input = `"${process.execPath}" "${probe}"\r\nexit\r\n`;
    } else if (windows) {
      const parent = join(root, 'parent.ps1');
      writeFileSync(parent, 'param([string]$Node,[string]$Probe)\n& $Node $Probe\nexit $LASTEXITCODE\n');
      args = ['-NoProfile', '-File', parent, '-Node', process.execPath, '-Probe', probe];
    } else args = [...(shell === 'zsh' ? ['-f'] : ['--noprofile', '--norc']), '-c', '"$1" "$2"; task_result=$?; exit "$task_result"', 'afyx-probe', process.execPath, probe];
    const result = spawnSync(shell, args, { input, encoding: 'utf8', windowsHide: true, timeout: 15_000,
      env: { ...process.env, SHELL: '/unrelated/login-shell', ComSpec: process.env.ComSpec || process.env.COMSPEC } });
    if (result.error?.code === 'ENOENT') { t.skip(`${shell} is unavailable`); return; }
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
    const json = result.stdout.match(/AFYX_ENVIRONMENT_JSON (\{[^\r\n]*\})/);
    assert.ok(json, result.stdout);
    const actual = JSON.parse(json[1]);
    const expected = { 'powershell.exe': 'Windows PowerShell', 'pwsh.exe': 'PowerShell', 'cmd.exe': 'CMD', bash: 'Bash', zsh: 'Zsh' }[shell];
    assert.equal(actual.invokingShell.name, expected, JSON.stringify(actual) + '\n' + result.stderr);
    assert.ok(actual.invokingShell.version, JSON.stringify(actual));
    assert.equal(actual.architecture, process.arch);
    console.log(JSON.stringify({ invoker: shell, environment: actual }));
  });
}
