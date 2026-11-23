import * as crypto from 'crypto';
import type { NodeKind } from '../types';

/** Stable graph identity independent of any parser implementation. */
export function generateNodeId(filePath: string, kind: NodeKind, name: string, line: number): string {
  const hash = crypto
    .createHash('sha256')
    .update(`${filePath}:${kind}:${name}:${line}`)
    .digest('hex')
    .substring(0, 32);
  return `${kind}:${hash}`;
}
