import { spawn, type SpawnOptions } from 'node:child_process';
import { BROWSER_ENV } from './constants';

export { BROWSER_ENV };

const DISABLED_BROWSER_TOKENS = new Set(['', 'none', '0', 'false', 'off']);

export interface OpenCommand {
  command: string;
  args: string[];
}

export function browserSpawnOptions(): SpawnOptions {
  return {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
  };
}

export function browserOpenCommand(
  url: string,
  platform: NodeJS.Platform,
  override?: string,
): OpenCommand | null {
  if (override !== undefined) {
    const value = override.trim();
    if (DISABLED_BROWSER_TOKENS.has(value.toLowerCase())) {
      return null;
    }
    return platform === 'win32'
      ? { command: 'cmd', args: ['/c', value, url] }
      : { command: value, args: [url] };
  }

  switch (platform) {
    case 'darwin':
      return { command: 'open', args: [url] };
    case 'win32':
      return { command: 'cmd', args: ['/c', 'start', '', url] };
    default:
      return { command: 'xdg-open', args: [url] };
  }
}

export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): boolean {
  const launch = browserOpenCommand(url, platform, process.env[BROWSER_ENV]);
  if (!launch) return false;

  try {
    const child = spawn(launch.command, launch.args, browserSpawnOptions());
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
