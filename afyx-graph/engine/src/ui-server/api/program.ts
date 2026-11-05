/**
 * AFYX Graph Engine - UI Server Program Flow Synthesizer
 *
 * Transforms flat traversal site records and branch guards into an ordered,
 * structured execution tree (WireProgram). Synthesizes branching forks,
 * conditional guards, inline call nesting, loop boundaries, and terminal exit
 * annotations for the AFYX Graph visualizer.
 */

import { guardLabel, type BranchGuard, type SiteLoop } from '../../graph/branch-guards';
import type { WireNodeRef } from './wire';

// =============================================================================
// Wire Protocol Types & Schemas
// =============================================================================

export type WireArmEnd = 'reply' | 'return' | 'throw' | 'exit';

export interface WireArm {
  when: string;
  not?: true;
  ends: WireArmEnd | null;
  body: WireBlock;
}

export type WireBlock = WireItem[];

export type WireItem =
  | {
      kind: 'step';
      step: string;
      link?: string;
      within?: string;
      body?: WireBlock;
      again?: true;
    }
  | {
      kind: 'fork';
      on: string;
      form: 'if' | 'switch' | 'ternary' | 'try';
      arms: WireArm[];
    }
  | {
      kind: 'block';
      block: 'inline' | 'loop' | 'later' | 'together';
      by?: string;
      loop?: 'each' | 'while';
      via?: WireNodeRef;
      within?: string;
      body: WireBlock;
      again?: true;
    }
  | {
      kind: 'cut';
      why: 'folded' | 'depth';
    };

export interface WireProgram {
  root: WireBlock;
  truncated: number;
}

// =============================================================================
// Traversal Record Inputs
// =============================================================================

export interface ProgramSite {
  step?: string;
  link?: string;
  into?: string;
  at: {
    line: number;
    column: number;
    end: { line: number; column: number };
  };
  within?: string;
  guards: BranchGuard[];
  loops?: SiteLoop[];
  trigger?: {
    kind: string;
    name: string;
    of?: string | null;
  };
}

export interface ProgramInput {
  sites: ReadonlyMap<string, readonly ProgramSite[]>;
  root: string | null;
  node(id: string): WireNodeRef | null;
  step(id: string): { reply: boolean; into: string | null } | null;
}

// =============================================================================
// Synthesis Constants & State
// =============================================================================

const DEFERRED_EXECUTION_TRIGGERS =
  /^(?:then|catch|finally|setTimeout|setInterval|setImmediate|queueMicrotask|requestAnimationFrame|useEffect|useLayoutEffect|addListener|addEventListener|on|once|subscribe|nextTick|process\.nextTick)$/;

const CONCURRENT_EXECUTION_CONSTRUCTS =
  /^(?:Promise\.(?:all|allSettled|any|race)|asyncio\.gather|Task\.WhenAll|Task\.WhenAny)$/;

const RECURSION_DEPTH_LIMIT = 8;
const MAX_SYNTHESIZED_ITEMS = 1200;

interface SynthesisContext {
  truncated: number;
  items: number;
  visitedFunctions: Set<string>;
}

interface OpenScopeState {
  branch: string;
  fork?: Extract<WireItem, { kind: 'fork' }>;
  armKey?: string;
  body: WireBlock;
}

type NestedScope =
  | { kind: 'guard'; branch: string; guard: BranchGuard }
  | { kind: 'loop'; branch: string; loop: SiteLoop };

// =============================================================================
// Core Program Assembly Pipeline
// =============================================================================

export function buildProgram(input: ProgramInput): WireProgram | null {
  if (input.root === null) {
    return null;
  }

  const context: SynthesisContext = {
    truncated: 0,
    items: 0,
    visitedFunctions: new Set([input.root]),
  };

  const synthesizedRoot = assembleFunctionBlock(input, input.root, [input.root], context);
  if (synthesizedRoot.length === 0) {
    return null;
  }

  return {
    root: synthesizedRoot,
    truncated: context.truncated,
  };
}

function assembleFunctionBlock(
  input: ProgramInput,
  functionId: string,
  ancestorChain: readonly string[],
  context: SynthesisContext,
): WireBlock {
  const sites = [...(input.sites.get(functionId) ?? [])].sort(orderSitesBySourceSpan);
  if (sites.length === 0) {
    return [];
  }

  const rootBlock: WireBlock = [];
  const scopeStack: OpenScopeState[] = [];

  const getTargetBlock = (depth: number): WireBlock => {
    return depth === 0 ? rootBlock : scopeStack[depth - 1]!.body;
  };

  for (const site of sites) {
    const scopes = extractSiteScopes(site);

    let matchCount = 0;
    while (
      matchCount < scopeStack.length &&
      matchCount < scopes.length &&
      isMatchingScope(scopeStack[matchCount]!, scopes[matchCount]!)
    ) {
      matchCount++;
    }

    const currentOpen = scopeStack[matchCount];
    const incomingScope = scopes[matchCount];

    if (
      currentOpen &&
      incomingScope &&
      currentOpen.branch === incomingScope.branch &&
      currentOpen.fork &&
      incomingScope.kind === 'guard'
    ) {
      scopeStack.length = matchCount + 1;
      currentOpen.armKey = generateArmKey(incomingScope.guard);
      currentOpen.body = ensureForkArm(currentOpen.fork, incomingScope.guard).body;
      matchCount++;
    } else {
      scopeStack.length = matchCount;
    }

    for (let i = matchCount; i < scopes.length; i++) {
      scopeStack.push(createScopeFrame(getTargetBlock(i), scopes[i]!));
    }

    const item = synthesizeSiteItem(input, site, ancestorChain, context);
    if (item !== null) {
      context.items++;
      dispatchItemToBlock(getTargetBlock(scopes.length), item, site);
    }
  }

  finalizeTerminalExits(input, rootBlock);
  return rootBlock;
}

function extractSiteScopes(site: ProgramSite): NestedScope[] {
  const guardScopes: NestedScope[] = site.guards.map((guard) => ({
    kind: 'guard',
    branch: guard.branch,
    guard,
  }));

  const loopScopes: NestedScope[] = (site.loops ?? []).map((loop) => ({
    kind: 'loop',
    branch: loop.branch,
    loop,
  }));

  if (loopScopes.length === 0) {
    return guardScopes;
  }

  return [...guardScopes, ...loopScopes].sort(
    (a, b) => parseBranchPosition(a.branch) - parseBranchPosition(b.branch) || a.branch.localeCompare(b.branch),
  );
}

function parseBranchPosition(branch: string): number {
  const [lineStr, colStr] = branch.split(':');
  const line = Number(lineStr) || 0;
  const col = Number(colStr) || 0;
  return line * 10000 + col;
}

function isMatchingScope(open: OpenScopeState, target: NestedScope): boolean {
  if (open.branch !== target.branch) {
    return false;
  }
  if (target.kind === 'loop') {
    return !open.fork;
  }
  return !!open.fork && open.armKey === generateArmKey(target.guard);
}

function createScopeFrame(parentBlock: WireBlock, scope: NestedScope): OpenScopeState {
  if (scope.kind === 'loop') {
    const loopBlock: Extract<WireItem, { kind: 'block' }> = {
      kind: 'block',
      block: 'loop',
      by: scope.loop.text,
      loop: scope.loop.kind,
      body: [],
    };
    parentBlock.push(loopBlock);
    return {
      branch: scope.branch,
      body: loopBlock.body,
    };
  }

  const g = scope.guard;
  const fork: Extract<WireItem, { kind: 'fork' }> = {
    kind: 'fork',
    on: guardLabel([{ ...g, negated: false }]),
    form: mapGuardForm(g),
    arms: [],
  };

  if (g.form === 'guard' && g.negated) {
    fork.arms.push({
      when: guardLabel([{ ...g, negated: false }]),
      ends: g.exit ?? 'return',
      body: [],
    });
  }

  parentBlock.push(fork);
  return {
    branch: scope.branch,
    fork,
    armKey: generateArmKey(g),
    body: ensureForkArm(fork, g).body,
  };
}

function synthesizeSiteItem(
  input: ProgramInput,
  site: ProgramSite,
  ancestorChain: readonly string[],
  context: SynthesisContext,
): WireItem | null {
  if (site.into) {
    const via = input.node(site.into);
    const inlineBlock: Extract<WireItem, { kind: 'block' }> = {
      kind: 'block',
      block: 'inline',
      ...(via ? { via } : {}),
      ...(site.within ? { within: site.within } : {}),
      body: [],
    };

    if (!canTraverseDeeper(site.into, ancestorChain, context)) {
      inlineBlock.again = true;
      return inlineBlock;
    }

    inlineBlock.body = assembleFunctionBlock(input, site.into, [...ancestorChain, site.into], context);
    return inlineBlock.body.length === 0 ? null : inlineBlock;
  }

  if (!site.step) {
    return null;
  }

  const stepMeta = input.step(site.step);
  const stepItem: Extract<WireItem, { kind: 'step' }> = {
    kind: 'step',
    step: site.step,
    ...(site.link ? { link: site.link } : {}),
    ...(site.within ? { within: site.within } : {}),
  };

  if (stepMeta?.into) {
    if (canTraverseDeeper(stepMeta.into, ancestorChain, context)) {
      const childBody = assembleFunctionBlock(input, stepMeta.into, [...ancestorChain, stepMeta.into], context);
      if (childBody.length > 0) {
        stepItem.body = childBody;
      }
    } else if (input.sites.has(stepMeta.into)) {
      stepItem.again = true;
    }
  }

  return stepItem;
}

function canTraverseDeeper(
  targetFunction: string,
  ancestorChain: readonly string[],
  context: SynthesisContext,
): boolean {
  if (ancestorChain.includes(targetFunction) || context.visitedFunctions.has(targetFunction)) {
    return false;
  }
  if (ancestorChain.length >= RECURSION_DEPTH_LIMIT || context.items >= MAX_SYNTHESIZED_ITEMS) {
    context.truncated++;
    return false;
  }
  context.visitedFunctions.add(targetFunction);
  return true;
}

function dispatchItemToBlock(targetBlock: WireBlock, item: WireItem, site: ProgramSite): void {
  const executionRun = determineExecutionGrouping(site);
  if (executionRun === null) {
    targetBlock.push(item);
    return;
  }

  const lastItem = targetBlock[targetBlock.length - 1];
  if (
    lastItem &&
    lastItem.kind === 'block' &&
    lastItem.block === executionRun.block &&
    lastItem.by === executionRun.by
  ) {
    lastItem.body.push(item);
    return;
  }

  targetBlock.push({
    kind: 'block',
    block: executionRun.block,
    ...(executionRun.by ? { by: executionRun.by } : {}),
    body: [item],
  });
}

function determineExecutionGrouping(site: ProgramSite): { block: 'later' | 'together'; by?: string } | null {
  const trigger = site.trigger;
  if (trigger && trigger.kind === 'callback' && DEFERRED_EXECUTION_TRIGGERS.test(trigger.name)) {
    return { block: 'later', by: trigger.name };
  }
  if (site.within && CONCURRENT_EXECUTION_CONSTRUCTS.test(site.within)) {
    return { block: 'together', by: site.within };
  }
  return null;
}

function ensureForkArm(fork: Extract<WireItem, { kind: 'fork' }>, guard: BranchGuard): WireArm {
  const label = guardLabel([guard]);
  const existing = fork.arms.find((a) => a.when === label);
  if (existing) {
    return existing;
  }

  const newArm: WireArm = {
    when: label,
    ...(guard.negated ? { not: true as const } : {}),
    ends: guard.armExit ?? null,
    body: [],
  };
  fork.arms.push(newArm);
  return newArm;
}

function generateArmKey(guard: BranchGuard): string {
  return `${guard.negated ? '!' : ''}${guard.text}`;
}

function mapGuardForm(guard: BranchGuard): 'if' | 'switch' | 'ternary' | 'try' {
  switch (guard.form) {
    case 'case':
      return 'switch';
    case 'ternary':
      return 'ternary';
    case 'catch':
      return 'try';
    default:
      return 'if';
  }
}

function finalizeTerminalExits(input: ProgramInput, block: WireBlock): void {
  for (const item of block) {
    if (item.kind === 'fork') {
      if (item.form === 'switch') {
        item.on = extractCommonSwitchPrefix(item.arms.map((a) => a.when));
      }
      for (const arm of item.arms) {
        finalizeTerminalExits(input, arm.body);
        if (terminatesWithReply(input, arm.body)) {
          arm.ends = 'reply';
        }
      }
    } else if (item.kind === 'block') {
      finalizeTerminalExits(input, item.body);
    } else if (item.kind === 'step' && item.body) {
      finalizeTerminalExits(input, item.body);
    }
  }
}

function extractCommonSwitchPrefix(armLabels: readonly string[]): string {
  if (armLabels.length < 2) {
    return '';
  }
  let common = armLabels[0]!;
  for (const label of armLabels.slice(1)) {
    let idx = 0;
    while (idx < common.length && idx < label.length && common[idx] === label[idx]) {
      idx++;
    }
    common = common.slice(0, idx);
  }
  const tokenMatch = /^[\w$.?[\]'"]+/.exec(common.trim());
  return tokenMatch ? tokenMatch[0] : '';
}

function terminatesWithReply(input: ProgramInput, block: WireBlock): boolean {
  const lastItem = block[block.length - 1];
  if (!lastItem) {
    return false;
  }
  if (lastItem.kind === 'step') {
    return input.step(lastItem.step)?.reply === true;
  }
  if (lastItem.kind === 'block') {
    return terminatesWithReply(input, lastItem.body);
  }
  return false;
}

function orderSitesBySourceSpan(a: ProgramSite, b: ProgramSite): number {
  if (isSpanEnclosed(a.at, b.at)) {
    return -1;
  }
  if (isSpanEnclosed(b.at, a.at)) {
    return 1;
  }
  return a.at.line - b.at.line || a.at.column - b.at.column;
}

function isSpanEnclosed(inner: ProgramSite['at'], outer: ProgramSite['at']): boolean {
  const startsAfter =
    inner.line > outer.line || (inner.line === outer.line && inner.column > outer.column);
  const endsBefore =
    inner.line < outer.end.line || (inner.line === outer.end.line && inner.column < outer.end.column);
  return startsAfter && endsBefore;
}
