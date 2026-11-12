#!/usr/bin/env node
// Read-only inventory for installer presentation. Provider configuration remains
// owned by afyx-provider-integration.mjs.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const catalog = [
  { id: 'antigravity', name: 'Antigravity', supported: true, commands: ['agy', 'antigravity'] },
  { id: 'claude', name: 'Claude Code', supported: true, commands: ['claude'], extension: 'anthropic.claude-code' },
  { id: 'codex', name: 'Codex', supported: true, commands: ['codex'], extension: 'openai.chatgpt' },
  { id: 'cursor', name: 'Cursor', supported: false, future: true, commands: ['cursor'] },
  { id: 'opencode', name: 'OpenCode', supported: false, future: true, commands: ['opencode'] },
];

function commandPath(name, env, platform) {
  const suffixes = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  for (const directory of (env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      const candidate = join(directory, name + suffix);
      try {
        if (!statSync(candidate).isFile()) continue;
        if (platform !== 'win32' && !(statSync(candidate).mode & 0o111)) continue;
        if (platform !== 'win32' && (candidate.toLowerCase().endsWith('.exe') || /^\/mnt\/[a-z]\//i.test(candidate))) continue;
        return resolve(candidate);
      } catch { /* absent PATH entry */ }
    }
  }
  return null;
}

function extensionProducts(home, platform) {
  const roots = ['.vscode', '.vscode-insiders'];
  if (platform !== 'win32') roots.push('.vscode-server');
  const found = [];
  for (const root of roots) {
    const directory = join(home, root, 'extensions');
    let names;
    try { names = readdirSync(directory); } catch { continue; }
    for (const name of names) {
      if (!/^(openai\.chatgpt|anthropic\.claude-code)-/i.test(name)) continue;
      const location = join(directory, name);
      try {
        const manifest = JSON.parse(readFileSync(join(location, 'package.json'), 'utf8'));
        const id = `${manifest.publisher}.${manifest.name}`.toLowerCase();
        if (!['openai.chatgpt', 'anthropic.claude-code'].includes(id)) continue;
        found.push({ id, path: location, version: String(manifest.version || '') });
      } catch { /* incomplete or unrecognized extension */ }
    }
  }
  return found;
}

function knownDesktopPaths(env, platform) {
  if (platform !== 'win32') return { antigravity: [], cursor: [] };
  const appPath = (executable) => {
    const reg = join(env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    for (const hive of ['HKCU', 'HKLM']) {
      const key = `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executable}`;
      const result = spawnSync(reg, ['query', key, '/ve'], { timeout: 1200,
        maxBuffer: 8192, encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) continue;
      const path = result.stdout.match(/REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/)?.[1]?.trim();
      if (path) return path;
    }
    return null;
  };
  return {
    antigravity: [
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'Antigravity', 'Antigravity.exe'),
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'Google Antigravity', 'Antigravity.exe'),
      env.ProgramFiles && join(env.ProgramFiles, 'Google', 'Antigravity', 'Antigravity.exe'),
      appPath('Antigravity.exe'),
    ].filter(Boolean),
    cursor: [env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'cursor', 'Cursor.exe'),
      appPath('Cursor.exe')].filter(Boolean),
  };
}

export function discoverProviderInventory({ platform = process.platform, env = process.env,
  home = env.HOME || env.USERPROFILE || homedir(), probe = null } = {}) {
  const commands = probe?.commands || null;
  const extensions = probe?.extensions || extensionProducts(home, platform);
  const desktops = probe?.desktops || knownDesktopPaths(env, platform);
  const isFile = probe ? (path) => (probe.files || []).includes(path) : (path) => {
    try { return statSync(path).isFile(); } catch { return false; }
  };
  const inventory = [];
  for (const entry of catalog) {
    const products = [];
    for (const command of entry.commands) {
      const location = commands ? commands[command] : commandPath(command, env, platform);
      if (!location) continue;
      if (platform !== 'win32' && (location.toLowerCase().endsWith('.exe') || /^\/mnt\/[a-z]\//i.test(location))) continue;
      products.push({ type: 'CLI', name: `${entry.name} CLI`, path: location,
        version: null, mcp: entry.supported, configuration: 'NOT_VERIFIED' });
      break; // aliases identify one product
    }
    for (const location of desktops[entry.id] || []) {
      if (isFile(location) && !products.some((product) => product.path.toLowerCase() === location.toLowerCase())) {
        products.push({ type: 'IDE/Desktop', name: entry.name, path: location,
          version: null, mcp: false, configuration: 'NOT_VERIFIED' });
      }
    }
    for (const extension of extensions) {
      if (extension.id?.toLowerCase() !== entry.extension) continue;
      if (products.some((product) => product.path.toLowerCase() === extension.path.toLowerCase())) continue;
      products.push({ type: 'VS Code Extension', name: entry.name, path: extension.path,
        version: extension.version || null, mcp: entry.id === 'claude', configuration: 'NOT_VERIFIED' });
    }
    if (!entry.supported && !products.length) continue;
    inventory.push({ id: entry.id, name: entry.name, supported: entry.supported,
      status: entry.supported ? 'SUPPORTED' : entry.future ? 'COMING SOON' : 'UNSUPPORTED', installed: products.length > 0,
      products });
  }
  return inventory.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export function formatProviderInventory(inventory) {
  const lines = [];
  for (const provider of inventory.filter((item) => item.supported)) {
    lines.push(provider.name);
    if (!provider.products.length) lines.push('  - Unavailable');
    for (const product of provider.products) lines.push(`  + ${product.type} · Installed${product.version ? ` · ${product.version}` : ''}`);
  }
  const other = inventory.filter((item) => !item.supported && item.installed);
  if (other.length) {
    lines.push('OTHER DETECTED');
    for (const provider of other) lines.push(`  - ${provider.name} · ${provider.status}`);
  }
  return lines;
}

export function selectableProviderIds(inventory) {
  return inventory.filter((provider) => provider.supported && provider.products.some((product) =>
    product.type === 'CLI' || (provider.id === 'claude' && product.type === 'VS Code Extension')))
    .map((provider) => provider.id);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const inventory = discoverProviderInventory();
  if (process.argv.includes('--lines')) process.stdout.write(formatProviderInventory(inventory).join('\n') + '\n');
  else if (process.argv.includes('--selected')) process.stdout.write(selectableProviderIds(inventory).join(',') + '\n');
  else process.stdout.write(JSON.stringify(inventory) + '\n');
}
