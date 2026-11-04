export { transitiveFileImpact, type FileImpactHost, type TransitiveFileImpactOptions, type TransitiveFileImpactResult } from './file-impact';
export {
  analyzeAffectedTests,
  computeAffectedTests,
  type AffectedTestsAnalysis,
  type AffectedTestsOptions,
  type AffectedTestsResult,
  type EmptyAffectedTestsReason,
} from './affected-tests';
export { mergeSymbolImpact, type SymbolImpactHost, type EdgeDedupOrder, type MergedImpact } from './symbol-impact';
export {
  computeOdooImpact,
  type OdooImpactResult,
  type OdooImpactedModel,
  type OdooImpactedSecurityAsset,
  type OdooImpactedModule,
} from './odoo-impact';
