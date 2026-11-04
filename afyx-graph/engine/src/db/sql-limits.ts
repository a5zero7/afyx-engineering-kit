/**
 * Placeholders bound per statement when an `IN (...)` list is split into chunks.
 *
 * SQLite caps bound variables per statement (999 on older builds, 32766 on the bundled
 * one); staying at 500 is safe on both and keeps each statement's plan simple.
 */
export const SQLITE_PARAM_CHUNK_SIZE = 500;

/** Placeholder list `?,?,?` for `count` bound values. */
export function placeholders(count: number): string {
  return new Array(count).fill('?').join(',');
}
