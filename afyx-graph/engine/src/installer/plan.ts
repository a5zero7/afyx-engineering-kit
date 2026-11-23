import type {
  AgentTarget,
  DetectionResult,
  InstallOptions,
  Location,
  TargetId,
  WriteResult,
} from './targets/types';

export type InstallPlanOperation = 'create' | 'update-or-repair' | 'unsupported';

export interface InstallPlanEntry {
  id: TargetId;
  displayName: string;
  location: Location;
  operation: InstallPlanOperation;
  supported: boolean;
  detection: DetectionResult;
  /** Exact target-owned paths the adapter may inspect or mutate on apply. */
  paths: string[];
  target: AgentTarget;
}

export interface InstallPlan {
  location: Location;
  options: Readonly<InstallOptions>;
  entries: InstallPlanEntry[];
}

export type InstallApplyStatus = 'configured' | 'unsupported' | 'verification-failed';

export interface InstallApplyReport {
  entry: InstallPlanEntry;
  status: InstallApplyStatus;
  result: WriteResult | null;
  verification: DetectionResult;
}

/**
 * Build a deterministic, side-effect-free provider plan. Provider adapters
 * retain ownership of their paths and formats; the plan only coordinates them.
 */
export function createInstallPlan(
  targets: readonly AgentTarget[],
  location: Location,
  options: InstallOptions,
): InstallPlan {
  const entries = targets.map((target): InstallPlanEntry => {
    const supported = target.supportsLocation(location);
    const detection = supported
      ? target.detect(location)
      : { installed: false, alreadyConfigured: false };
    return {
      id: target.id,
      displayName: target.displayName,
      location,
      operation: !supported
        ? 'unsupported'
        : detection.alreadyConfigured ? 'update-or-repair' : 'create',
      supported,
      detection,
      paths: supported ? [...target.describePaths(location)] : [],
      target,
    };
  });
  return {
    location,
    options: Object.freeze({ ...options }),
    entries,
  };
}

/** Apply exactly one previously inspected plan, then verify each target. */
export function applyInstallPlan(plan: InstallPlan): InstallApplyReport[] {
  return plan.entries.map((entry): InstallApplyReport => {
    if (!entry.supported) {
      return {
        entry,
        status: 'unsupported',
        result: null,
        verification: entry.detection,
      };
    }
    const result = entry.target.install(plan.location, plan.options);
    const verification = entry.target.detect(plan.location);
    return {
      entry,
      result,
      verification,
      status: verification.alreadyConfigured ? 'configured' : 'verification-failed',
    };
  });
}

/** Serializable view used by previews and tests; excludes executable adapters. */
export function describeInstallPlan(plan: InstallPlan) {
  return {
    location: plan.location,
    options: { ...plan.options },
    targets: plan.entries.map(({ target: _target, ...entry }) => entry),
  };
}
