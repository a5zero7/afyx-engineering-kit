/**
 * AFYX Engineering Kit - Alias Binding Resolution
 *
 * Resolves indirect symbol bindings (aliased constants, local re-exports, object literal delegates)
 * to their concrete callable implementations, ensuring accurate call edge attribution across renames.
 */

import type { Node } from '../types';
import type { ResolutionContext } from './types';

const ALIAS_SOURCE_KINDS: ReadonlySet<string> = new Set<string>(['constant', 'variable', 'property']);
const CALLABLE_TARGET_KINDS: ReadonlySet<string> = new Set<string>(['function', 'method', 'class', 'component']);

const SIMPLE_ASSIGNMENT_REGEX = /^=\s*([A-Za-z_$][\w$]*)\s*(?:as\s+[\w.<>[\]]+\s*)?;?$/;

function sanitizeRegexString(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses node signatures to detect targeted identifier names for alias forwarding.
 */
export function aliasTargetName(
  signature: string | undefined | null,
  memberName: string | null
): string | null {
  if (!signature) return null;
  const trimmedSignature = signature.trim();

  if (memberName) {
    const escapedPropName = sanitizeRegexString(memberName);
    const explicitPattern = new RegExp(`[{,]\\s*${escapedPropName}\\s*:\\s*([A-Za-z_$][\\w$]*)\\s*[,}]`);
    const explicitMatch = explicitPattern.exec(trimmedSignature);
    if (explicitMatch) return explicitMatch[1]!;

    const shorthandPattern = new RegExp(`[{,]\\s*(${escapedPropName})\\s*[,}]`);
    const shorthandMatch = shorthandPattern.exec(trimmedSignature);
    if (shorthandMatch) return shorthandMatch[1]!;

    return null;
  }

  const bareMatch = SIMPLE_ASSIGNMENT_REGEX.exec(trimmedSignature);
  return bareMatch ? bareMatch[1]! : null;
}

/**
 * Resolves an alias node to its underlying callable graph node.
 */
export function resolveAliasBinding(
  aliasNode: Node,
  memberName: string | null,
  context: ResolutionContext
): Node | null {
  if (!ALIAS_SOURCE_KINDS.has(aliasNode.kind)) return null;

  const targetIdentifier = aliasTargetName(aliasNode.signature, memberName);
  if (!targetIdentifier || targetIdentifier === aliasNode.name) return null;

  const candidateNodes = context
    .getNodesByName(targetIdentifier)
    .filter((n) => CALLABLE_TARGET_KINDS.has(n.kind));

  if (candidateNodes.length === 0) return null;

  const sameFileMatches = candidateNodes.filter((n) => n.filePath === aliasNode.filePath);
  if (sameFileMatches.length === 1) return sameFileMatches[0]!;
  if (sameFileMatches.length > 1) return null;

  return candidateNodes.length === 1 ? candidateNodes[0]! : null;
}

/**
 * Extracts local export clause aliases without `from` specifiers from source content.
 */
export function extractLocalExportAliases(content: string): Array<{ exportedName: string; localName: string }> {
  const extractedAliases: Array<{ exportedName: string; localName: string }> = [];
  const exportPattern = /export\s*\{([^}]*)\}\s*(?!\s*from)[;\n]/g;

  let matchResult: RegExpExecArray | null;
  while ((matchResult = exportPattern.exec(content)) !== null) {
    const rawSpecifiers = matchResult[1]!.split(',');
    for (const token of rawSpecifiers) {
      const trimmed = token.trim();
      if (!trimmed || /^type\s/.test(trimmed)) continue;

      const aliasMatch = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/.exec(trimmed);
      if (aliasMatch) {
        extractedAliases.push({ localName: aliasMatch[1]!, exportedName: aliasMatch[2]! });
        continue;
      }

      if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
        extractedAliases.push({ localName: trimmed, exportedName: trimmed });
      }
    }
  }

  return extractedAliases;
}
