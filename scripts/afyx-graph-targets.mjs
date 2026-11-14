/** Kit runtime support is explicit. Schema 1 preserves the published Alpha.7 pair. */
export const GRAPH_PACKAGE_TARGETS = Object.freeze(['win32-x64', 'linux-x64', 'darwin-arm64', 'darwin-x64']);
export const graphArchiveName = (target) => `afyx-graph-${target}.${target.startsWith('win32-') ? 'zip' : 'tar.gz'}`;
export function graphManifestTargets(manifest) {
  if (manifest?.schema === 1 || manifest?.schema === undefined) return GRAPH_PACKAGE_TARGETS.slice(0, 2);
  if (manifest?.schema === 2) return [...GRAPH_PACKAGE_TARGETS];
  throw new Error('Unsupported Graph release schema');
}
