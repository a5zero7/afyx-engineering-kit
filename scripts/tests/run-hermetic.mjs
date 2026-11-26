import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const here = new URL('./', import.meta.url);
const exclusions = new Map([
  ['test_browser_devtools.mjs', 'Real Chromium fixture in MB12.'],
  ['test_browser_engineering.mjs', 'Real Chromium fixture in MB12.'],
  ['test_browser_temp_alias.mjs', 'Real Chromium fixture in MB12.'],
  ['test_browser_mcp_ergonomics_budget.mjs', 'Browser MCP capability acceptance with optional Chromium.'],
  ['test_cross_repo_forge_integration.mjs', 'Requires compiled Graph and isolated peer runtimes. Graph and Forge acceptance exercise native contracts.'],
  ['test_legacy_skill_migration_and_multiprovider.mjs', 'Requires a release archive and provider runtime installation. Installer UX validates a staged candidate.'],
  ['test_mb10_integrated_scenario.mjs', 'Requires compiled Graph. Graph integration and Context tests exercise the active contract.'],
  ['test_mock_ide_agent_session.mjs', 'Requires compiled Graph. Graph build workflow exercises the real CLI and MCP.'],
  ['test_phase8_runner_signal.mjs', 'Requires the Phase 8 tokenizer devdependency. Runs in Phase 8 Dogfood.'],
  ['test_prepare_interactive_dogfood_session.mjs', 'Requires a clean committed checkout. Runs in the CI workflow.'],
  ['test_release_zip_graph.mjs', 'Requires staged release packages. Installer UX checks the packaged candidate.'],
  ['test_trackc_w3a_cross_domain_sqlite_lifecycle.mjs', 'Legacy Graph TypeScript harness. Native SQLite lifecycle runs in Graph Vitest.'],
  ['test_trackc_w3a_extractors.mjs', 'Legacy Graph TypeScript harness. Native extractors run in Graph Vitest.'],
  ['test_trackc_w3b_benchmarks.mjs', 'Legacy performance harness. This audit does not run benchmark campaigns.'],
  ['test_unified_integration.mjs', 'Requires compiled Graph and integrated product runtimes. CI runs provider and Graph/Context integration.'],
  ['test_encoding_guard.mjs', 'Tracked-tree encoding check in the tool-family-routing workflow.'],
  ['test_graph_mb3_runtime_sqlite_lifecycle.mjs', 'Requires a built Graph runtime. Graph workflow tests the built runtime.'],
  ['test_installer_environment_live.mjs', 'Native shell discovery in Installer UX.'],
  ['test_npm_package_smoke.mjs', 'Requires a committed tree and staged release artifacts. Installer UX validates candidate setup.'],
  ['test_pack_json.mjs', 'Requires staged Graph archives. Dedicated command npm run test:pack-json.'],
  ['test_real_hosts_mcp_lifecycle.mjs', 'Requires explicitly authorized native providers. Provider fixtures run in this suite.'],
]);

const discovered = readdirSync(here)
  .filter((name) => /^test_.*\.mjs$/.test(name))
  .sort();
for (const name of exclusions.keys()) {
  if (!discovered.includes(name)) throw new Error('Stale hermetic suite exclusion: ' + name);
}
const selected = discovered.filter((name) => !exclusions.has(name));
console.log(JSON.stringify({ discovered: discovered.length, selected: selected.length, exclusions: Object.fromEntries(exclusions) }));
if (!process.argv.includes('--list')) {
  const args = ['--test', '--test-concurrency=1', ...selected.map((name) => fileURLToPath(new URL(name, here)))];
  const child = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}
