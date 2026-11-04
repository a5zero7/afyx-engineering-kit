/**
 * Stable public entry point for conservative dead-code reporting.
 *
 * The implementation lives in `dead-code-policy`: this module intentionally
 * remains the import boundary used by the graph facade and UI API.
 */
export * from './dead-code-policy';
