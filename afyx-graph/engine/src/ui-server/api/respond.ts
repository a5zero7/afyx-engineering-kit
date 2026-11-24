import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../static';

export type ApiErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'refused'
  | 'no-index'
  | 'index-unusable'
  | 'internal';

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_QUERY_LENGTH = 2_000;

const HTTP_STATUS_MAP: Readonly<Record<ApiErrorCode, number>> = {
  'bad-request': 400,
  refused: 403,
  'not-found': 404,
  internal: 500,
  'no-index': 503,
  'index-unusable': 503,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly hint: string | undefined;

  constructor(code: ApiErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.hint = hint;
  }
}

export function badRequest(message: string, hint?: string): ApiError {
  return new ApiError('bad-request', message, hint);
}

export function notFound(message: string, hint?: string): ApiError {
  return new ApiError('not-found', message, hint);
}

export function ok(res: ServerResponse, payload: unknown, method: string): true {
  sendJson(res, 200, payload, method);
  return true;
}

export function fail(res: ServerResponse, err: unknown, method: string): true {
  if (err instanceof ApiError) {
    const payload = err.hint
      ? { error: err.message, code: err.code, hint: err.hint }
      : { error: err.message, code: err.code };
    sendJson(res, HTTP_STATUS_MAP[err.code], payload, method);
    return true;
  }

  const message = err instanceof Error ? err.message : String(err);
  sendJson(res, 500, { error: message, code: 'internal' satisfies ApiErrorCode }, method);
  return true;
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const buffers: Buffer[] = [];
  let totalBytes = 0;

  try {
    for await (const rawChunk of req) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        throw badRequest(`Request body exceeds ${MAX_BODY_BYTES} byte limit.`);
      }
      buffers.push(chunk);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw badRequest('Unable to read request body.');
  }

  if (totalBytes === 0) {
    throw badRequest('Request body must contain JSON.');
  }

  try {
    return JSON.parse(Buffer.concat(buffers, totalBytes).toString('utf-8')) as unknown;
  } catch {
    throw badRequest('Request body contains malformed JSON.');
  }
}

function enforceLengthCap(value: string, name: string): string {
  if (value.length > MAX_QUERY_LENGTH) {
    throw badRequest(`Parameter "${name}" exceeds ${MAX_QUERY_LENGTH} characters.`);
  }
  return value;
}

export function requiredParam(query: URLSearchParams, name: string): string {
  const value = query.get(name);
  if (value === null || value.trim().length === 0) {
    throw badRequest(`Missing required parameter "${name}".`);
  }
  return value;
}

export function intParam(
  query: URLSearchParams,
  name: string,
  opts: { min: number; max: number; default?: number },
): number {
  const raw = query.get(name);
  if (raw === null || raw.trim().length === 0) {
    if (opts.default !== undefined) return opts.default;
    throw badRequest(`Missing required parameter "${name}".`);
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < opts.min || parsed > opts.max) {
    throw badRequest(`Parameter "${name}" must be an integer in [${opts.min}, ${opts.max}] (received "${raw}").`);
  }
  return parsed;
}

export function textParam(query: URLSearchParams, name: string): string {
  return enforceLengthCap(requiredParam(query, name), name);
}

export function optionalTextParam(query: URLSearchParams, name: string): string {
  const value = query.get(name);
  if (value === null) {
    throw badRequest(`Missing required parameter "${name}".`);
  }
  return enforceLengthCap(value, name);
}
