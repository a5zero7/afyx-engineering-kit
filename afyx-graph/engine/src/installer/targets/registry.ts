/**
 * AFYX Graph Engine - Installer Target Registry
 *
 * Maintains the canonical catalog of supported editor, IDE, and AI agent targets
 * for configuration and tool installation across developer workspaces.
 */

import { AgentTarget, Location, TargetId } from './types';
import { claudeTarget } from './claude';
import { cursorTarget } from './cursor';
import { codexTarget } from './codex';
import { opencodeTarget } from './opencode';
import { hermesTarget } from './hermes';
import { geminiTarget } from './gemini';
import { antigravityTarget } from './antigravity';
import { kiroTarget } from './kiro';
import { copilotVscodeTarget } from './copilot-vscode';
import { copilotCliTarget } from './copilot-cli';
import { copilotJetbrainsTarget } from './copilot-jetbrains';

/**
 * Static registry of supported installation targets in canonical selection order.
 */
export const ALL_TARGETS: readonly AgentTarget[] = Object.freeze([
  claudeTarget,
  cursorTarget,
  codexTarget,
  opencodeTarget,
  hermesTarget,
  geminiTarget,
  antigravityTarget,
  kiroTarget,
  copilotVscodeTarget,
  copilotCliTarget,
  copilotJetbrainsTarget,
]);

/** Lookup a single target definition by unique identifier. */
export function getTarget(id: string): AgentTarget | undefined {
  return ALL_TARGETS.find((target) => target.id === id);
}

/** Retrieve all registered target identifiers in catalog order. */
export function listTargetIds(): TargetId[] {
  return ALL_TARGETS.map((target) => target.id);
}

/**
 * Execute environment detection across all registered targets for a workspace location.
 */
export function detectAll(loc: Location): Array<{
  target: AgentTarget;
  detection: ReturnType<AgentTarget['detect']>;
}> {
  return ALL_TARGETS.map((target) => ({
    target,
    detection: target.detect(loc),
  }));
}

/**
 * Parse and resolve `--target` CLI parameter strings into validated AgentTarget instances.
 * Supports special directives ('none', 'all', 'auto') or comma-separated target IDs.
 */
export function resolveTargetFlag(value: string, loc: Location): AgentTarget[] {
  const normalized = value.trim();

  if (normalized === 'none') {
    return [];
  }

  if (normalized === 'all') {
    return [...ALL_TARGETS];
  }

  if (normalized === 'auto') {
    const installed = detectAll(loc)
      .filter(({ detection }) => detection.installed)
      .map(({ target }) => target);

    if (installed.length > 0) {
      return installed;
    }

    const defaultFallback = getTarget('claude');
    return defaultFallback ? [defaultFallback] : [];
  }

  const requestedIds = normalized
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const matchedTargets: AgentTarget[] = [];
  const unrecognizedIds: string[] = [];

  for (const id of requestedIds) {
    const target = getTarget(id);
    if (target) {
      matchedTargets.push(target);
    } else {
      unrecognizedIds.push(id);
    }
  }

  if (unrecognizedIds.length > 0) {
    const validCatalog = listTargetIds().join(', ');
    throw new Error(
      `Unknown --target id(s): ${unrecognizedIds.join(', ')}. Known: ${validCatalog}, plus 'auto' / 'all' / 'none'.`,
    );
  }

  return matchedTargets;
}
