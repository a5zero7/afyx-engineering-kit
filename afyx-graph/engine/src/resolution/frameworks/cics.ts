/**
 * AFYX Engineering Kit - Resolution Engine
 * Subsystem: Framework Resolvers (COBOL CICS Pseudo-Conversational Router)
 *
 * Maps CICS transaction dispatch identifiers (`cics-transid:XXXX`) to the
 * corresponding COBOL program unit that declares the transaction identifier
 * in its working-storage or linkage section.
 */

import type { Node } from '../../types';
import type {
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';

/** Protocol prefix emitted by COBOL extractor for EXEC CICS RETURN/START calls */
const CICS_TRANSID_PROTOCOL = 'cics-transid:';

/** Identifier pattern indicating transaction ID field convention */
const TRANSACTION_IDENTIFIER_PATTERN = /TRAN/i;

/** Pattern capturing 1-4 character transaction code literals in COBOL declarations */
const TRANSACTION_VALUE_PATTERN = /\bVALUE\s+['"]([A-Za-z0-9$#@]{1,4})['"]/i;

/** Confidence rating for matched CICS pseudo-conversational program dispatch */
const CICS_DISPATCH_CONFIDENCE = 0.85;

/** Context-scoped index mapping uppercase transaction code -> owning COBOL module Node ID */
const contextTransactionCache = new WeakMap<ResolutionContext, Map<string, string>>();

/**
 * Builds or retrieves the transaction directory for a specific resolution session.
 * Scans variable, field, and constant nodes in COBOL source files for transaction ID declarations.
 */
function resolveTransactionIndex(context: ResolutionContext): Map<string, string> {
  const existing = contextTransactionCache.get(context);
  if (existing) {
    return existing;
  }

  const index = new Map<string, string>();
  const symbolCandidates: Node[] = [
    ...context.getNodesByKind('variable'),
    ...context.getNodesByKind('field'),
    ...context.getNodesByKind('constant'),
  ];

  for (const candidate of symbolCandidates) {
    if (candidate.language !== 'cobol' || !TRANSACTION_IDENTIFIER_PATTERN.test(candidate.name)) {
      continue;
    }

    if (!candidate.signature) {
      continue;
    }

    const valueMatch = TRANSACTION_VALUE_PATTERN.exec(candidate.signature);
    if (!valueMatch || !valueMatch[1]) {
      continue;
    }

    const transactionId = valueMatch[1].toUpperCase();
    if (index.has(transactionId)) {
      // First declaration retained; ambiguous multi-declarations defer to primary definition
      continue;
    }

    const moduleInFile = context
      .getNodesInFile(candidate.filePath)
      .find((node) => node.kind === 'module' && node.language === 'cobol');

    if (moduleInFile) {
      index.set(transactionId, moduleInFile.id);
    }
  }

  contextTransactionCache.set(context, index);
  return index;
}

export const cicsResolver: FrameworkResolver = {
  name: 'cics',
  languages: ['cobol'],

  detect(context: ResolutionContext): boolean {
    const rootModules = context.getNodesByKind('module');
    for (let i = 0; i < rootModules.length; i++) {
      if (rootModules[i]!.language === 'cobol') {
        return true;
      }
    }
    return false;
  },

  claimsReference(name: string): boolean {
    return name.startsWith(CICS_TRANSID_PROTOCOL);
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (!ref.referenceName.startsWith(CICS_TRANSID_PROTOCOL)) {
      return null;
    }

    const transactionCode = ref.referenceName
      .slice(CICS_TRANSID_PROTOCOL.length)
      .toUpperCase();

    if (!transactionCode) {
      return null;
    }

    const directory = resolveTransactionIndex(context);
    const targetModuleId = directory.get(transactionCode);
    if (!targetModuleId) {
      return null;
    }

    return {
      original: ref,
      targetNodeId: targetModuleId,
      confidence: CICS_DISPATCH_CONFIDENCE,
      resolvedBy: 'framework',
    };
  },
};
