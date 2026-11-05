/**
 * AFYX Graph dead-code presentation model.
 *
 * The API payload is converted into a small immutable summary before any UI
 * wording is produced. Keeping arithmetic separate from rendering makes the
 * safety caveat and exclusion accounting independently testable.
 */

import { plural } from './symbol-model';
import { kindWord } from './kinds';
import type { WireDeadCode, WireDeadCodeGroup, WireDeadCodeRow } from './wire';

export const DEAD_CODE_CAVEAT =
  'No static reference in the index — dynamic use is possible.';

export interface DeadCodeSummary {
  candidateCount: number;
  excludedCount: number;
  fileCount: number;
  lineCount: number;
  shownCount: number;
  totalCount: number;
  truncated: boolean;
}

export function summarizeDeadCode(payload: WireDeadCode): DeadCodeSummary {
  return Object.freeze({
    candidateCount: payload.candidates,
    excludedCount: payload.excludedTotal,
    fileCount: payload.groups.length,
    lineCount: payload.groups.reduce((total, group) => total + group.lines, 0),
    shownCount: payload.rows.shown,
    totalCount: payload.rows.total,
    truncated: payload.rows.truncated,
  });
}

function counted(value: number, noun: string): string {
  return `${value.toLocaleString()} ${value === 1 ? noun : `${noun}s`}`;
}

function facts(values: readonly string[]): string {
  return values.filter(Boolean).join(' · ');
}

export function deadCodeHeadline(payload: WireDeadCode | null): string {
  if (payload === null) return '';
  const summary = summarizeDeadCode(payload);
  if (summary.totalCount === 0) return 'Nothing on this list.';

  const rowCount = summary.truncated
    ? `${summary.shownCount} of ${counted(summary.totalCount, 'symbol')}`
    : counted(summary.totalCount, 'symbol');
  return facts([
    `${rowCount} in ${counted(summary.fileCount, 'file')}`,
    counted(summary.lineCount, 'line'),
  ]);
}

export function deadCodeScale(payload: WireDeadCode | null): string {
  if (payload === null) return '';
  const summary = summarizeDeadCode(payload);
  if (summary.candidateCount === 0) return '';
  return `${counted(summary.candidateCount, 'symbol')} in this index carry no incoming reference at all; ${summary.excludedCount.toLocaleString()} of them were left off this list.`;
}

export function exclusionPhrases(payload: WireDeadCode | null): string[] {
  return payload?.excluded.map(({ count, label }) => `${count.toLocaleString()} ${label}`) ?? [];
}

export function deadCodeRowMeta(row: WireDeadCodeRow): string {
  const memberImpact = row.members.total > 0
    ? `${plural(row.members.total, 'member')} unreachable with it`
    : '';
  return facts([kindWord(row.kind), plural(row.lines, 'line'), memberImpact]);
}

export function groupMeta(group: WireDeadCodeGroup): string {
  return facts([
    plural(group.rows.length, 'symbol'),
    plural(group.lines, 'line'),
    group.generated ? 'generated' : '',
  ]);
}

export function emptyMessage(payload: WireDeadCode): string {
  const summary = summarizeDeadCode(payload);
  if (summary.candidateCount === 0) {
    return 'Every symbol in this index is referenced by something. Nothing to show.';
  }
  if (payload.includeExported) {
    return `Every one of the ${summary.candidateCount.toLocaleString()} symbols with no incoming reference has a reason to be reachable anyway — see the list of exclusions below.`;
  }
  return `All ${summary.candidateCount.toLocaleString()} symbols with no incoming reference are either reachable from outside this repository or excluded for the reasons below. Turn on "including exported" to see the ones the index cannot check.`;
}
