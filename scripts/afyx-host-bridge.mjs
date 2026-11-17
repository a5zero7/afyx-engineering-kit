#!/usr/bin/env node

/**
 * Provider-neutral host bridge connecting AI coding hosts (Antigravity, Codex, Claude)
 * to the AFYX Universal Interoperability Runtime.
 *
 * Implements supported, verifiable host entrypoints:
 * 1. Programmatic API: invokeHostWorkflow(options)
 * 2. CLI Entrypoint: node scripts/afyx-host-bridge.mjs --task '<json>' ...
 * 3. JSON-RPC 2.0 Stdio MCP Server: node scripts/afyx-host-bridge.mjs serve --mcp
 */

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

import {
  runInstalledAfyxWorkflow,
} from './afyx-universal-runtime.mjs';
import { createOptionalCapabilityHost } from './afyx-optional-capabilities.mjs';

export const AFYX_HOST_BRIDGE_CONTRACT = 'AfyxHostBridge/v1';

/**
 * Normalizes host invocation options and runs the installed AFYX workflow.
 *
 * @param {Object} options
 * @param {Object|string} options.task - Engineering task specification
 * @param {string} [options.projectRoot] - Root directory of the target project
 * @param {string} [options.installRoot] - Root directory where AFYX components are installed
 * @param {string} [options.provider] - Host provider: 'antigravity', 'codex', or 'claude'
 * @param {Object} [options.authorizations] - Map of authorized component IDs
 * @param {Object} [options.providerPermissions] - Map of provider permissions
 * @param {Object} [options.budgetLimits] - Budget limits override
 * @param {Object} [options.environment] - Environment variables
 * @param {Object} [options.trustedSkillEngineering] - Host-supplied plan and approval callback; never MCP tool input
 * @returns {Promise<Object>} Workflow execution result with host bridge envelope
 */
export async function invokeHostWorkflow({
  task = {},
  projectRoot = process.cwd(),
  installRoot = process.env.AFYX_INSTALL_ROOT || null,
  provider = 'antigravity',
  authorizations = {},
  providerPermissions = null,
  budgetLimits = undefined,
  hostTimeoutMs,
  environment = process.env,
  trustedSkillEngineering = null,
  trustedCapabilities = {},
  hostMetadata = {},
  loadCapabilityDetails,
} = {}) {
  const parsedTask = typeof task === 'string' ? JSON.parse(task) : task;
  const graphSymbol = parsedTask?.payload?.symbol;
  if (['callers', 'caller-analysis', 'impact', 'symbol-impact'].includes(parsedTask?.taskType) &&
      graphSymbol !== undefined && (typeof graphSymbol !== 'string' || !graphSymbol.trim())) {
    throw new TypeError('INVALID_GRAPH_SYMBOL: task.payload.symbol must be a non-empty string');
  }
  const resolvedProjectRoot = resolve(projectRoot);
  const resolvedInstallRoot = installRoot ? resolve(installRoot) : null;
  const permissions = providerPermissions ?? authorizations;

  const workflowResult = await runInstalledAfyxWorkflow({
    task: parsedTask,
    projectRoot: resolvedProjectRoot,
    installRoot: resolvedInstallRoot,
    provider,
    authorizations,
    providerPermissions: permissions,
    budgetLimits,
    hostTimeoutMs,
    environment,
    trustedSkillEngineering,
    trustedCapabilities,
    hostMetadata,
    loadCapabilityDetails,
  });

  return {
    ...workflowResult,
    bridgeContract: AFYX_HOST_BRIDGE_CONTRACT,
    host: {
      provider,
      projectRoot: resolvedProjectRoot,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Runs a lightweight stdio MCP server for host environments that interact via MCP.
 *
 * @param {Object} [serverOptions]
 * @param {string} [serverOptions.installRoot]
 * @param {string} [serverOptions.projectRoot]
 * @param {string} [serverOptions.provider]
 */
export function serveHostMcpBridge(serverOptions = {}) {
  const optional = createOptionalCapabilityHost({ projectRoot: serverOptions.projectRoot,
    browser: serverOptions.trustedCapabilities?.browser,
    document: serverOptions.trustedCapabilities?.document });
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const sendResponse = (response) => {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  };

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    optional.close().then(() => process.exit(0), () => {
      process.stderr.write('AFYX_OPTIONAL_CLEANUP_FAILED\n');
      process.exit(1);
    });
  };
  rl.on('close', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      sendResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON' },
      });
      return;
    }

    const { id, method, params } = request;

    // Handle JSON-RPC notifications (no id)
    if (id === undefined || id === null) {
      return;
    }

    switch (method) {
      case 'initialize': {
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'afyx-universal-host-bridge',
              version: '1.0.0',
            },
          },
        });
        break;
      }

      case 'tools/list': {
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'afyx_workflow',
                description: 'Execute task-driven AFYX capability workflow for the host environment.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    task: {
                      type: 'object',
                      description: 'Engineering task. For Graph callers/impact use e.g. {"taskType":"callers","payload":{"symbol":"createProject"}}. The symbol is a non-empty string, not an object.',
                      properties: { taskType: { type: 'string' } },
                      allOf: [{
                        if: { properties: { taskType: { enum: ['callers', 'caller-analysis', 'impact', 'symbol-impact'] } }, required: ['taskType'] },
                        then: { properties: { payload: { type: 'object', properties: { symbol: { type: 'string', minLength: 1 } } } } },
                      }],
                    },
                  },
                  required: ['task'],
                },
              },
              { name: 'afyx_capabilities', description: 'Discover authorized optional capabilities for a task intent without starting them.',
                inputSchema: { type: 'object', additionalProperties: false, properties: { intent: { type: 'string', enum: ['browser', 'document-conversion'] } }, required: ['intent'] } },
              ...optional.tools(),
            ],
          },
        });
        break;
      }

      case 'tools/call': {
        if (params?.name === 'afyx_capabilities' || params?.name === 'afyx_browser' || params?.name === 'afyx_document') {
          try {
            const value = params.name === 'afyx_capabilities'
              ? { capabilities: optional.discover(params.arguments), started: false }
              : await optional.call(params.name, params.arguments);
            let structured = value && typeof value === 'object' && !Array.isArray(value) ? value : { result: value };
            const images = [];
            if (params.name === 'afyx_browser' && params.arguments?.action === 'screenshot' && typeof value?.screenshotBase64 === 'string') {
              const bytes = Buffer.from(value.screenshotBase64, 'base64');
              structured = { screenshot: { mimeType: 'image/png', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
              images.push({ type: 'image', mimeType: 'image/png', data: value.screenshotBase64 });
            }
            const output = { ...structured, contentTrust: 'untrusted-data' };
            sendResponse({ jsonrpc: '2.0', id, result: { structuredContent: output, content: [{ type: 'text', text: JSON.stringify(output) }, ...images] } });
          } catch (error) {
            sendResponse({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] } });
          }
          break;
        }

        if (params?.name !== 'afyx_workflow') {
          sendResponse({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Unknown tool: ${params?.name}` },
          });
          break;
        }

        try {
          const args = params.arguments || {};
          const result = await invokeHostWorkflow({
            task: args.task,
            ...serverOptions,
          });

          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
              structuredContent: result,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            },
          });
        } catch (err) {
          sendResponse({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32000,
              message: err instanceof Error ? err.message : String(err),
            },
          });
        }
        break;
      }

      default: {
        sendResponse({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
        break;
      }
    }
  });

  return rl;
}

function trustedLaunchCapabilities() {
  const repositories = (argumentValue('--github-repositories') || '').split(',').filter(Boolean);
  const enabled = new Set((argumentValue('--capabilities') || '').split(',').filter(Boolean));
  for (const item of enabled) if (!['browser', 'document'].includes(item)) throw new Error('UNKNOWN_OPTIONAL_CAPABILITY');
  const capabilities = {};
  if (repositories.length) {
    capabilities.github = { allowedRepositories: repositories };
    capabilities.githubExecutable = argumentValue('--github-gh-executable');
  }
  if (enabled.has('document')) capabilities.document = { enabled: true };
  if (enabled.has('browser')) capabilities.browser = { enabled: true,
    allowedOrigins: (argumentValue('--browser-origins') || '').split(',').filter(Boolean),
    allowEvaluation: process.argv.includes('--browser-evaluation'),
    uploadRoot: argumentValue('--browser-upload-root'), exportRoot: argumentValue('--browser-export-root') };
  return capabilities;
}

function argumentValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

async function main() {
  const trustedCapabilities = trustedLaunchCapabilities();
  const timeoutArg = argumentValue('--host-timeout-ms');
  const hostTimeoutMs = timeoutArg === null ? undefined : Number(timeoutArg);
  if (hostTimeoutMs !== undefined && (!Number.isSafeInteger(hostTimeoutMs) || hostTimeoutMs < 1 || hostTimeoutMs > 60_000)) {
    throw new TypeError('--host-timeout-ms must be an integer between 1 and 60000');
  }
  if (trustedCapabilities.githubExecutable) {
    const { createGhRequest } = await import('./afyx-native-github.mjs');
    trustedCapabilities.github.request = createGhRequest({ executable: trustedCapabilities.githubExecutable,
      projectRoot: resolve(argumentValue('--project-root') || process.cwd()) });
    trustedCapabilities.github.authMode = 'HOST_GH_SESSION';
    delete trustedCapabilities.githubExecutable;
  }

  if (process.argv.includes('--mcp') || (process.argv.includes('serve') && process.argv.includes('--mcp'))) {
    const installRoot = argumentValue('--install-root');
    const projectRoot = argumentValue('--project-root');
    const provider = argumentValue('--provider') || 'antigravity';
    const authorizedIds = new Set((argumentValue('--authorize') ?? '').split(',').filter(Boolean));
    const authorizations = Object.fromEntries([...authorizedIds].map((id) => [id, true]));
    serveHostMcpBridge({
      hostTimeoutMs,
      trustedCapabilities,
      installRoot,
      projectRoot,
      provider,
      authorizations,
      providerPermissions: authorizations,
    });
    return;
  }

  const installRoot = argumentValue('--install-root') || process.env.AFYX_INSTALL_ROOT;
  const projectRoot = argumentValue('--project-root') || process.cwd();
  const provider = argumentValue('--provider') || 'antigravity';
  const taskArg = argumentValue('--task');
  const taskFile = argumentValue('--task-file');
  const authorizedIds = new Set((argumentValue('--authorize') ?? '').split(',').filter(Boolean));

  let task = null;
  if (taskArg) {
    task = JSON.parse(taskArg);
  } else if (taskFile) {
    if (taskFile === '-') {
      task = JSON.parse(readFileSync(0, 'utf8'));
    } else {
      task = JSON.parse(readFileSync(resolve(taskFile), 'utf8'));
    }
  } else {
    throw new Error('Either --task <json> or --task-file <file> is required');
  }

  const authorizations = Object.fromEntries([...authorizedIds].map((id) => [id, true]));
  const result = await invokeHostWorkflow({
    hostTimeoutMs,
    trustedCapabilities,
    installRoot,
    projectRoot,
    task,
    provider,
    authorizations,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === 'FAILED' || result.status === 'BLOCKED') {
    process.exitCode = 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
