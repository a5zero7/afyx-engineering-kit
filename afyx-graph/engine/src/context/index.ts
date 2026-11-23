/**
 * Context: turns a query into a bounded, ranked slice of the code graph, and renders it.
 * The pipeline lives in ./builder; this module is the stable import path.
 */
export { ContextBuilder, createContextBuilder } from './builder';
export { LOW_CONFIDENCE_MARKER } from './markers';
export { formatContextAsMarkdown, formatContextAsJson } from './renderers';
