/**
 * AFYX Graph Engine - Exploration Trail Wire Format Codec
 *
 * Implements deterministic serialization and URL encoding for interactive graph
 * exploration trails, allowing complex multi-hop investigation paths to be shared,
 * bookmarked, and restored without server-side session dependencies.
 */

export type HopDirection = 'start' | 'down' | 'up';

export interface TrailHop {
  /** Unique symbol or file identifier for this hop. */
  id: string;
  /** Human-readable symbol name, or null if unresolved. */
  name: string | null;
  /** Symbol kind descriptor, or null if unresolved. */
  kind: string | null;
  /** Direction of the exploration step relative to the previous hop. */
  dir: HopDirection;
}

const DIRECTION_PREFIX_MAP: Readonly<Record<HopDirection, string>> = Object.freeze({
  start: 's',
  down: 'd',
  up: 'u',
});

const PREFIX_DIRECTION_MAP: Readonly<Record<string, HopDirection>> = Object.freeze({
  s: 'start',
  d: 'down',
  u: 'up',
});

const HEX_HASH_PATTERN = /^[0-9a-f]{16,}$/i;

/**
 * Derives a readable display label for a trail hop, providing resilient fallbacks
 * when the node name has not yet been resolved from the index.
 */
export function hopLabel(hop: TrailHop): string {
  if (hop.name) {
    return hop.name;
  }

  const rawIdentifier = hop.id;
  const separatorIndex = rawIdentifier.indexOf(':');
  const entityBody = separatorIndex >= 0 ? rawIdentifier.slice(separatorIndex + 1) : rawIdentifier;

  const slashIndex = entityBody.lastIndexOf('/');
  const baseSegment = slashIndex >= 0 ? entityBody.slice(slashIndex + 1) : entityBody;

  if (baseSegment.length === 0 || baseSegment.length > 40) {
    return `${entityBody.slice(0, 8)}…`;
  }

  if (HEX_HASH_PATTERN.test(baseSegment)) {
    return `${baseSegment.slice(0, 8)}…`;
  }

  return baseSegment;
}

/**
 * Encodes an ordered sequence of trail hops into a compact, URL-safe comma-separated string.
 */
export function encodeTrail(hops: readonly TrailHop[]): string {
  return hops
    .map((hop) => {
      const prefix = DIRECTION_PREFIX_MAP[hop.dir] ?? 'd';
      return `${prefix}${encodeURIComponent(hop.id)}`;
    })
    .join(',');
}

/**
 * Parses an encoded trail string into structured trail hops, failing closed on malformed tokens.
 */
export function decodeTrail(encoded: string | null): TrailHop[] {
  if (!encoded || typeof encoded !== 'string') {
    return [];
  }

  const hops: TrailHop[] = [];
  const rawTokens = encoded.split(',');

  for (const token of rawTokens) {
    if (token.length < 2) {
      continue;
    }

    const directionChar = token.charAt(0);
    const direction = PREFIX_DIRECTION_MAP[directionChar];
    if (!direction) {
      continue;
    }

    let decodedId: string;
    try {
      decodedId = decodeURIComponent(token.slice(1));
    } catch {
      // Retain the unencoded token segment so malformed params do not silently drop positions
      decodedId = token.slice(1);
    }

    hops.push({
      id: decodedId,
      name: null,
      kind: null,
      dir: direction,
    });
  }

  return hops;
}
