import * as crypto from 'crypto';

/** Stable content identity shared by full and incremental extraction. */
export function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
