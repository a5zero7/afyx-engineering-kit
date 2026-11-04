import { defineConfig } from 'vitest/config';

// Fresh Windows runners on Node 24+ are more reliable with a bounded fork pool.
// Linux and macOS retain Vitest's default worker policy.
const capWindowsNodeWorkers =
  process.platform === 'win32' && Number.parseInt(process.versions.node, 10) >= 24;

/**
 * The SHARED base. `vitest.workspace.mts` extends it twice — once for the
 * engine's node-environment suites and once for the viewer package's jsdom
 * one — so the environment, the plugins and the module-resolution conditions
 * a browser test needs cannot leak into the other 200-odd suites.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10_000,
    // Node 26 on Windows oversubscribes the Git/SQLite-heavy integration suite
    // at Vitest's CPU-derived default. The resulting timeouts and stale daemon
    // observations disappear with bounded concurrency; product behavior and
    // per-test assertions remain unchanged.
    ...(capWindowsNodeWorkers ? { maxWorkers: 4 } : {}),
    include: ['__tests__/**/*.test.ts'],
    /**
     * Several MCP integration tests (mcp-daemon, mcp-initialize, mcp-ppid-watchdog,
     * mcp-roots) spawn `dist/bin/afyx-graph.js serve --mcp` with `process.execPath`
     * and rely on the child inheriting `process.env`. On a Node >= 25 dev machine
     * the CLI's hard-block (src/bin/afyx-graph.ts) would otherwise exit the child
     * before it ever responds, so every spawn-based test times out — see #478.
     *
     * Setting the override here keeps the CLI's runtime guard intact for end
     * users (it's still enforced when `afyx-graph` is invoked directly) while
     * letting the test suite run on whatever Node the contributor happens to
     * have installed. CI on Node 22/23 is unaffected — the guard doesn't fire
     * there, so the variable is a no-op.
     */
    env: {
      AFYX_GRAPH_ALLOW_UNSAFE_NODE: '1',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'engine',
          include: ['__tests__/**/*.test.ts'],
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '__tests__/ui-package.test.ts',
            '__tests__/ui-native-runtime.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'ui',
          globals: true,
          include: ['__tests__/ui-package.test.ts', '__tests__/ui-native-runtime.test.ts'],
          environment: 'jsdom',
        },
      },
    ],
  },
});
