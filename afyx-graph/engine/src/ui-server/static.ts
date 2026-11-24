import { createReadStream, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, relative, sep } from 'node:path';

const MIME_BY_EXTENSION = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.wasm', 'application/wasm'],
]);

const DEFAULT_MIME = 'application/octet-stream';
const IMMUTABLE_ASSETS_CACHE = 'public, max-age=31536000, immutable';
const NO_STORE_CACHE = 'no-store';

export function contentTypeFor(filePath: string): string {
  return MIME_BY_EXTENSION.get(extname(filePath).toLowerCase()) ?? DEFAULT_MIME;
}

export function cacheControlFor(relativePath: string): string {
  const posixRel = relativePath.split(sep).join('/');
  return posixRel.startsWith('assets/') ? IMMUTABLE_ASSETS_CACHE : NO_STORE_CACHE;
}

function writeBufferResponse(
  res: ServerResponse,
  status: number,
  contentType: string,
  payload: Buffer,
  method: string,
): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': String(payload.byteLength),
    'Cache-Control': NO_STORE_CACHE,
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  res.end(payload);
}

export function sendText(res: ServerResponse, status: number, message: string, method: string): void {
  const text = message.endsWith('\n') ? message : `${message}\n`;
  writeBufferResponse(res, status, 'text/plain; charset=utf-8', Buffer.from(text, 'utf-8'), method);
}

export function sendJson(res: ServerResponse, status: number, payload: unknown, method: string): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  writeBufferResponse(res, status, 'application/json; charset=utf-8', body, method);
}

export function sendFile(
  res: ServerResponse,
  absolutePath: string,
  options: { rootDir: string; method: string; extraHeaders?: Record<string, string> },
): void {
  let fileStat;
  try {
    fileStat = statSync(absolutePath);
  } catch {
    sendText(res, 404, 'Not found', options.method);
    return;
  }

  const relPath = relative(options.rootDir, absolutePath);
  res.writeHead(200, {
    'Content-Type': contentTypeFor(absolutePath),
    'Content-Length': String(fileStat.size),
    'Cache-Control': cacheControlFor(relPath),
    'Last-Modified': fileStat.mtime.toUTCString(),
    ...options.extraHeaders,
  });

  if (options.method === 'HEAD') {
    res.end();
    return;
  }

  const readStream = createReadStream(absolutePath);
  const cleanup = () => readStream.destroy();
  readStream.once('error', () => res.destroy());
  res.once('close', cleanup);
  readStream.pipe(res);
}

export function shouldFallBackToIndex(pathname: string): boolean {
  return extname(pathname) === '';
}
