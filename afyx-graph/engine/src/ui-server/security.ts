import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { PathRefusalError } from '../errors';
import { validatePathWithinRoot, validateProjectPath } from '../utils';

export { PathRefusalError };

const ALLOWED_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const CONTROL_OR_BACKSLASH = /[\x00-\x1f\x7f\\]/;
const WRITE_CONTENT_TYPE = 'application/json';

export const READ_METHODS: readonly string[] = ['GET', 'HEAD'];
export const WRITE_METHODS: readonly string[] = ['POST', 'DELETE'];
export const ALLOWED_METHODS: readonly string[] = [...READ_METHODS, ...WRITE_METHODS];
export const WRITE_HEADER = 'x-afyx-graph-ui';

interface ParsedAuthority {
  host: string;
  port: number | undefined;
}

export function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.includes(method);
}

export function isWriteRequest(
  pathname: string,
  headers: { marker: string | undefined; contentType: string | undefined },
): { ok: true } | { ok: false; reason: string } {
  const isApiPath = pathname === '/api' || pathname.startsWith('/api/');
  if (!isApiPath) {
    return { ok: false, reason: 'Only /api/ routes accept mutating requests.' };
  }
  if (!headers.marker || headers.marker.trim().length === 0) {
    return { ok: false, reason: `Missing required ${WRITE_HEADER} header.` };
  }
  if (headers.contentType !== undefined) {
    const mediaType = headers.contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (mediaType.length > 0 && mediaType !== WRITE_CONTENT_TYPE) {
      return { ok: false, reason: `Content-Type must be ${WRITE_CONTENT_TYPE}.` };
    }
  }
  return { ok: true };
}

function parsePort(portText: string): number | undefined | null {
  if (portText.length === 0) return undefined;
  if (!portText.startsWith(':')) return null;
  const rawDigits = portText.slice(1);
  if (!/^\d{1,5}$/.test(rawDigits)) return null;
  const portNum = Number(rawDigits);
  return portNum >= 0 && portNum <= 65535 ? portNum : null;
}

function parseAuthority(rawHost: string): ParsedAuthority | null {
  const trimmed = rawHost.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.startsWith('[')) {
    const closeBracket = trimmed.indexOf(']');
    if (closeBracket < 0) return null;
    const port = parsePort(trimmed.slice(closeBracket + 1));
    if (port === null) return null;
    return { host: trimmed.slice(1, closeBracket), port };
  }

  const colonIdx = trimmed.indexOf(':');
  if (colonIdx < 0) return { host: trimmed, port: undefined };
  if (trimmed.indexOf(':', colonIdx + 1) >= 0) return null;

  const port = parsePort(trimmed.slice(colonIdx));
  if (port === null) return null;
  return { host: trimmed.slice(0, colonIdx), port };
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
  if (typeof host !== 'string') return false;
  const parsed = parseAuthority(host);
  if (!parsed) return false;
  if (!ALLOWED_LOOPBACK_HOSTS.has(parsed.host.toLowerCase())) return false;
  return parsed.port === undefined || parsed.port === port;
}

export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  const trimmed = origin.trim();
  if (trimmed.length === 0) return true;
  if (trimmed === 'null') return false;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') return false;
  const normalizedHost = parsedUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!ALLOWED_LOOPBACK_HOSTS.has(normalizedHost)) return false;
  return parsedUrl.port === '' || Number(parsedUrl.port) === port;
}

function safeDecodeSegment(rawPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  return CONTROL_OR_BACKSLASH.test(decoded) ? null : decoded;
}

export function isSafeRequestPath(rawPath: string): boolean {
  const decoded = safeDecodeSegment(rawPath);
  return decoded !== null && !decoded.split('/').includes('..');
}

export function resolveStaticAsset(rootDir: string, urlPath: string): string | null {
  const decoded = safeDecodeSegment(urlPath);
  if (decoded === null) return null;

  const relPath = decoded.replace(/^\/+/, '');
  const resolved = validatePathWithinRoot(rootDir, relPath);
  if (!resolved) return null;

  try {
    return statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

export function resolveProjectFile(projectRoot: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
    throw new PathRefusalError('File path must be a non-empty string.');
  }

  const decoded = safeDecodeSegment(relativePath);
  if (decoded === null) {
    throw new PathRefusalError(`Refusing unusable path: ${relativePath}`);
  }

  const rootViolation = validateProjectPath(projectRoot);
  if (rootViolation) throw new PathRefusalError(rootViolation);

  if (isAbsolute(decoded)) {
    throw new PathRefusalError(`Refusing absolute path: ${decoded}`);
  }

  const verified = validatePathWithinRoot(projectRoot, decoded);
  if (!verified) {
    throw new PathRefusalError(`Refusing path outside project root: ${decoded}`);
  }
  return verified;
}
