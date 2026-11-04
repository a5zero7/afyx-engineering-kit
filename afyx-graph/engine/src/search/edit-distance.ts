/**
 * Bounded Levenshtein distance for fuzzy name fallback.
 *
 * Returns the exact distance when it is within `maxDistance`; once a whole row of
 * the table exceeds the bound the scan stops and `maxDistance + 1` is returned,
 * which keeps the fallback cheap over very large name sets. Length differences
 * beyond the bound are rejected up front. Comparison is by UTF-16 code unit, so
 * callers pass already case-folded strings. Uses two reusable integer rows.
 */
export function boundedEditDistance(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0;
  const rows = a.length;
  const columns = b.length;
  if (Math.abs(rows - columns) > maxDistance) return maxDistance + 1;
  if (rows === 0) return columns;
  if (columns === 0) return rows;

  const above = new Int32Array(columns + 1);
  const here = new Int32Array(columns + 1);
  for (let column = 0; column <= columns; column++) above[column] = column;

  let previousRow = above;
  let currentRow = here;
  for (let row = 1; row <= rows; row++) {
    const rowChar = a.charCodeAt(row - 1);
    currentRow[0] = row;
    let smallest = row;
    for (let column = 1; column <= columns; column++) {
      const substitution = previousRow[column - 1]! + (rowChar === b.charCodeAt(column - 1) ? 0 : 1);
      const best = Math.min(substitution, previousRow[column]! + 1, currentRow[column - 1]! + 1);
      currentRow[column] = best;
      if (best < smallest) smallest = best;
    }
    if (smallest > maxDistance) return maxDistance + 1;
    const spare = previousRow;
    previousRow = currentRow;
    currentRow = spare;
  }
  return previousRow[columns]!;
}
