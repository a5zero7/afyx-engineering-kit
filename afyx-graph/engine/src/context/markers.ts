/**
 * Sentinel text shared by the context builder (which appends it to a low-confidence answer) and
 * the MCP layer (which detects it to drop the "this is comprehensive" footer that would contradict
 * it). A dependency-free leaf, so recognising the sentinel does not load the context pipeline on the
 * cold-start path. Both sides import this constant; changing the text changes the contract.
 */
export const LOW_CONFIDENCE_MARKER = '### ⚠️ Low-confidence match';
