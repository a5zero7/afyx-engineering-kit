/**
 * AFYX Graph Engine - Exploration Trails Presentation Model
 *
 * Implements authoritative presentation logic for saved exploration walks,
 * decay analysis for codebase drift detection, and deterministic formatting
 * for display, export, and interactive state restoration.
 */

import type { WireTrail, WireTrailHop, WireTrailHopStatus } from './wire';
import { plural } from './symbol-model';

/** Maximum number of specific hop names explicitly enumerated in decay alerts. */
export const MAX_NAMED_DECAYED = 3;

export interface TrailDecay {
  /** Severity level: 'warn' for unopenable/ambiguous drift, 'note' for relocation. */
  tone: 'warn' | 'note';
  /** Human-readable explanation of how the trail decayed relative to the current index. */
  text: string;
}

/**
 * Returns a summary metadata string indicating total saved length and author attribution.
 */
export function trailMeta(trail: WireTrail): string {
  const hopCount = plural(trail.hops.length, 'hop');
  return trail.author ? `${hopCount} · ${trail.author}` : hopCount;
}

/**
 * Maps a hop resolution status to human-readable presentation terminology.
 */
export function hopStatusWord(status: WireTrailHopStatus): string {
  switch (status) {
    case 'ok':
      return 'still here';
    case 'moved':
      return 'moved';
    case 'ambiguous':
      return 'ambiguous';
    case 'missing':
      return 'gone';
  }
}

/**
 * Formats a bounded list of hop names for human-readable sentences.
 */
function formatNameList(hops: readonly WireTrailHop[]): string {
  const displayedNames = hops.slice(0, MAX_NAMED_DECAYED).map((h) => h.name);
  const remainingCount = hops.length - displayedNames.length;

  let formatted = '';
  if (displayedNames.length === 1) {
    formatted = displayedNames[0]!;
  } else if (displayedNames.length > 1) {
    formatted = `${displayedNames.slice(0, -1).join(', ')} and ${displayedNames[displayedNames.length - 1]}`;
  }

  return remainingCount > 0 ? `${formatted} and ${remainingCount} more` : formatted;
}

/**
 * Evaluates whether an existing trail has experienced codebase drift since creation,
 * returning prioritized warning or informational notices.
 */
export function trailDecay(trail: WireTrail): TrailDecay | null {
  const missingHops = trail.hops.filter((h) => h.status === 'missing');
  const ambiguousHops = trail.hops.filter((h) => h.status === 'ambiguous');
  const movedHops = trail.hops.filter((h) => h.status === 'moved');

  if (missingHops.length > 0) {
    return {
      tone: 'warn',
      text: `${plural(missingHops.length, 'hop')} moved or renamed since this was saved — ${formatNameList(missingHops)} no longer in the index.`,
    };
  }

  if (ambiguousHops.length > 0) {
    const verb = ambiguousHops.length === 1 ? 'names' : 'name';
    return {
      tone: 'warn',
      text: `${formatNameList(ambiguousHops)} now ${verb} more than one symbol — showing the closest match.`,
    };
  }

  if (movedHops.length > 0) {
    return {
      tone: 'note',
      text: `${formatNameList(movedHops)} moved to another file since this was saved.`,
    };
  }

  return null;
}

/**
 * Determines whether a trail can be partially or fully opened in the current index.
 */
export function trailOpens(trail: WireTrail): string | null {
  if (trail.encoded === null) {
    return 'None of this trail resolves in the current index.';
  }

  if (trail.openCount === trail.hops.length) {
    return null;
  }

  const lastOpenHop = trail.openFrom + trail.openCount - 1;
  const rangeLabel = trail.openCount === 1 ? `hop ${trail.openFrom}` : `hops ${trail.openFrom}–${lastOpenHop}`;
  return `Opens ${rangeLabel} of ${trail.hops.length}.`;
}

/**
 * Checks whether at least one target symbol in the trail can be navigated to.
 */
export function isOpenable(trail: WireTrail): boolean {
  return trail.encoded !== null && trail.openId !== null;
}

function directionSymbol(hop: WireTrailHop): string {
  if (hop.dir === 'up') return '←';
  if (hop.dir === 'down') return '→';
  return '·';
}

/**
 * Generates an ordered text summary of the full exploration path including navigation arrows.
 */
export function trailTitle(trail: WireTrail): string {
  const pathParts = trail.hops.map((hop, index) => {
    return index === 0 ? hop.name : `${directionSymbol(hop)} ${hop.name}`;
  });

  const timestampSuffix = trail.updatedAt ? ` — saved ${trail.updatedAt.slice(0, 10)}` : '';
  return `${pathParts.join(' ')}${timestampSuffix}`;
}

/**
 * Validates a candidate trail name against length and non-empty constraints.
 */
export function trailNameProblem(name: string, maxLength: number): string | null {
  const cleaned = name.trim();
  if (cleaned.length === 0) {
    return 'Give the trail a name.';
  }
  if (cleaned.length > maxLength) {
    return `That name is too long (max ${maxLength} characters).`;
  }
  return null;
}

/**
 * Finds an existing trail that matches the normalized name candidate.
 */
export function replacedTrail(name: string, trails: readonly WireTrail[]): WireTrail | null {
  const normalizedCandidate = name.trim().replace(/\s+/g, ' ');
  return trails.find((t) => t.name === normalizedCandidate) ?? null;
}

/**
 * Serializes an exploration trail into its persistent, portable JSON representation.
 */
export function trailExport(trail: WireTrail): string {
  const serialized = {
    version: 1,
    id: trail.id,
    name: trail.name,
    note: trail.note,
    author: trail.author,
    createdAt: trail.createdAt,
    updatedAt: trail.updatedAt,
    hops: trail.hops.map((hop) => ({
      dir: hop.dir,
      name: hop.name,
      qualifiedName: hop.qualifiedName,
      kind: hop.kind,
      file: hop.savedFile,
      line: hop.savedLine,
      id: hop.id ?? '',
    })),
  };

  return `${JSON.stringify(serialized, null, 2)}\n`;
}
