/**
 * Afyx Forge Core — Doctor & Environment Diagnostic
 * Inspects host surfaces, runtime components, and governance boundaries.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function checkCommand(cmd) {
  try {
    const isWin = process.platform === 'win32';
    const checkCmd = isWin ? `where ${cmd}` : `which ${cmd}`;
    execSync(checkCmd, { stdio: 'pipe', encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

function checkPathExists(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

/**
 * Runs a comprehensive health diagnostic of the Forge Core runtime and its integration environment.
 * @returns {object} Diagnostic report
 */
export function runDoctor() {
  const homeDir = os.homedir();
  const nodeVersion = process.version;
  const platform = `${process.platform} (${os.arch()})`;

  // 1. Host Agent Surfaces
  const hasCodex = checkCommand('codex');
  const hasAgy = checkCommand('agy') || checkCommand('antigravity');
  const hasClaude = checkCommand('claude');

  // 2. Afyx Runtime Components
  const hasGraphCli = checkCommand('afyx-graph');
  const hasContextCli = checkCommand('afyx-context');

  const graphRuntimeDir = process.env.AFYX_GRAPH_RUNTIME_ROOT || path.join(homeDir, '.afyx', 'graph');
  const contextRuntimeDir = process.env.AFYX_CONTEXT_RUNTIME_ROOT || path.join(homeDir, '.afyx', 'context');
  const forgeRuntimeDir = process.env.AFYX_FORGE_RUNTIME_ROOT || path.join(homeDir, '.afyx', 'forge');

  const isGraphInstalled = hasGraphCli || checkPathExists(path.join(graphRuntimeDir, 'metadata.json'));
  const isContextInstalled = hasContextCli || checkPathExists(path.join(contextRuntimeDir, 'metadata.json'));
  const isForgeInstalled = checkPathExists(path.join(forgeRuntimeDir, 'metadata.json'));

  // 3. Skills Presence
  const agentsSkillsDir = path.join(homeDir, '.agents', 'skills');
  const geminiSkillsDir = path.join(homeDir, '.gemini', 'config', 'skills');

  const hasEfficientCoding =
    checkPathExists(path.join(agentsSkillsDir, 'efficient-coding')) ||
    checkPathExists(path.join(geminiSkillsDir, 'efficient-coding'));
  const hasOdooEngineering =
    checkPathExists(path.join(agentsSkillsDir, 'odoo-engineering')) ||
    checkPathExists(path.join(geminiSkillsDir, 'odoo-engineering'));
  const hasEngineeringExpert =
    checkPathExists(path.join(agentsSkillsDir, 'afyx-engineering-expert')) ||
    checkPathExists(path.join(geminiSkillsDir, 'afyx-engineering-expert'));

  // 4. Governance & Evaluation Gate
  const evaluationGate = {
    gate: 'A8_FORMAL_CAMPAIGN',
    status: 'EVALUATION_GATED (0/36 NOT_RUN)',
    autonomousExecutionAllowed: false,
    uncontrolledModelCost: false,
    runtimeMode: 'ASSISTIVE_GUIDANCE_ONLY',
  };

  return {
    forgeCoreVersion: '0.1.0',
    runtime: {
      nodeVersion,
      platform,
    },
    agentSurfaces: {
      codex: hasCodex ? 'DETECTED' : 'UNAVAILABLE',
      antigravity: hasAgy ? 'DETECTED' : 'UNAVAILABLE',
      claude: hasClaude ? 'DETECTED' : 'UNAVAILABLE',
    },
    afyxComponents: {
      afyxGraph: isGraphInstalled ? 'HEALTHY' : 'NOT_INSTALLED',
      afyxContext: isContextInstalled ? 'HEALTHY (DEFAULT OFF)' : 'NOT_INSTALLED',
      afyxForgeCore: isForgeInstalled ? 'INSTALLED' : 'DEVELOPMENT_SOURCE',
    },
    skills: {
      efficientCoding: hasEfficientCoding ? 'INSTALLED' : 'NOT_FOUND',
      odooEngineering: hasOdooEngineering ? 'INSTALLED' : 'NOT_FOUND',
      engineeringExpert: hasEngineeringExpert ? 'INSTALLED' : 'NOT_FOUND',
    },
    governance: evaluationGate,
  };
}

