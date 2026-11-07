/**
 * AFYX native skill capability for a trusted, in-process provider host.
 * An agent task can SELECT this adapter but cannot define its write plan,
 * choose the target root, or grant host approval.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  createSkill, packageSkill, previewSkillInstall, applySkillInstall,
  verifySkillInstall, negotiateSkillProvider,
} from './afyx-skill-engineering.mjs';

export const AFYX_NATIVE_SKILL_HOST_CONTRACT = 'AfyxNativeSkillHost/v1';
const CAPABILITY = 'skill-authoring-lifecycle';
const NAME = /^[a-z][a-z0-9-]{1,63}$/;
const claimedHostPlans = new WeakSet();

const digest = (value) => createHash('sha256').update(value).digest('hex');
const beneath = (parent, child) => {
  const rest = relative(parent, child);
  return rest === '' || (rest !== '..' && !rest.startsWith('..' + sep) && !isAbsolute(rest));
};
const denied = (reason) => ({ status: 'FAILED', reason, output: null });

function trustedRoot(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || !existsSync(path)) {
    throw new Error('TRUSTED_ROOT_REQUIRED');
  }
  const root = resolve(path);
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root) {
    throw new Error('TRUSTED_ROOT_UNSAFE');
  }
  return root;
}

/**
 * The host supplies every option directly from trusted application state.
 * Never pass task JSON or MCP tool arguments into this factory.
 * Approval is synchronous because the underlying atomic install API is synchronous.
 */
export function createNativeSkillHostAdapter(config = {}) {
  const { provider, scope = 'workspace', draftsRoot, skillsRoot, spec,
    peerRoots = [], authorize } = config;
  if (negotiateSkillProvider(provider, scope).status !== 'SUPPORTED'
      || typeof authorize !== 'function'
      || !spec || typeof spec !== 'object' || !NAME.test(spec.name)
      || typeof spec.description !== 'string'
      || typeof spec.body !== 'string'
      || !Array.isArray(spec.triggers)
      || spec.triggers.some((trigger) => typeof trigger !== 'string')
      || !Array.isArray(peerRoots)) {
    throw new Error('TRUSTED_SKILL_HOST_CONFIG_INVALID');
  }
  const draftRoot = trustedRoot(draftsRoot);
  const installRoot = trustedRoot(skillsRoot);
  if (beneath(draftRoot, installRoot) || beneath(installRoot, draftRoot)) {
    throw new Error('TRUSTED_SKILL_ROOTS_OVERLAP');
  }
  const peers = Object.freeze(peerRoots.map(trustedRoot));
  const skillSpec = Object.freeze({
    name: spec.name, description: spec.description,
    triggers: Object.freeze([...spec.triggers]), body: spec.body,
  });
  const planDigest = digest(JSON.stringify(skillSpec));
  const sourceIdentity = 'sha256:' + digest(Buffer.concat([
    readFileSync(new URL(import.meta.url)),
    readFileSync(new URL('./afyx-skill-engineering.mjs', import.meta.url)),
  ]));
  let consumed = false;

  const adapter = async (request) => {
    if (request?.targetComponentId !== 'afyx-skill-engineering'
        || request.capability !== CAPABILITY
        || request.permissions?.authorized !== true
        || !request.candidateProviders?.includes(provider)
        || request.sourceIdentity !== sourceIdentity) {
      return denied('TRUSTED_HOST_REQUEST_DENIED');
    }
    // One approved plan may be executed only once per host adapter instance.
    // Consume before touching disk, including denied and failed attempts.
    if (consumed || claimedHostPlans.has(config)) return denied('TRUSTED_SKILL_PLAN_CONSUMED');
    consumed = true;
    claimedHostPlans.add(config);

    const proposal = Object.freeze({
      contract: AFYX_NATIVE_SKILL_HOST_CONTRACT,
      action: 'CREATE_DRAFT',
      provider, scope, skillName: skillSpec.name, planDigest,
      draftsRoot: draftRoot, skillsRoot: installRoot,
    });
    try {
      if (authorize(proposal) !== true) return denied('HOST_APPROVAL_REQUIRED');
      const draft = join(draftRoot, skillSpec.name);
      createSkill(draft, skillSpec);
      const packageBytes = packageSkill(draft);
      const preview = previewSkillInstall(packageBytes, {
        provider, scope, skillsRoot: installRoot, peerRoots: peers,
      });
      if (preview.action !== 'INSTALL') return denied('EXISTING_SKILL_PROTECTED');
      // A separate trusted host authorization is required for the exact install preview.
      const installed = applySkillInstall(packageBytes, preview, { authorize });
      const verification = verifySkillInstall({ provider, skillsRoot: installRoot, name: skillSpec.name });
      if (installed.status !== 'VERIFIED' || verification.status !== 'VERIFIED') {
        return denied('NATIVE_SKILL_INSTALL_UNVERIFIED');
      }
      return {
        status: 'SUCCESS',
        output: Object.freeze({
          contract: AFYX_NATIVE_SKILL_HOST_CONTRACT,
          provider, scope, name: skillSpec.name,
          digest: verification.digest, status: 'VERIFIED',
        }),
        evidence: Object.freeze([{ kind: 'native-skill-verified', digest: verification.digest }]),
      };
    } catch {
      // Never return OS paths, proposal bodies, adapter errors or credential-like data.
      return denied('NATIVE_SKILL_HOST_OPERATION_FAILED');
    }
  };
  return Object.freeze({ sourceIdentity, adapter });
}
