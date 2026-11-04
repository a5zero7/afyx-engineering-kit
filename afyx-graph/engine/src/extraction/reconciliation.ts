import type { FileRecord } from '../types';

export interface SourceStat {
  size: number;
  mtimeMs: number;
}

export interface ReconciliationIO {
  exists(filePath: string): boolean;
  stat(filePath: string): SourceStat;
  read(filePath: string): string;
}

export interface ReconciliationInput {
  currentFiles: readonly string[];
  trackedFiles: readonly FileRecord[];
  filesChecked: number;
  io: ReconciliationIO;
  hash(content: string): string;
  onRemove(file: FileRecord): void;
  onReadFailure?(filePath: string, operation: 'stat' | 'read', error: unknown): void;
  yieldEvery?: number;
  yieldControl?(): Promise<void>;
}

export interface ReconciliationResult {
  filesChecked: number;
  filesAdded: number;
  filesModified: number;
  filesRemoved: number;
  filesToIndex: string[];
  changedFilePaths: string[];
  failedFilePaths: string[];
}

/**
 * Reconcile filesystem evidence with persisted extraction file records.
 *
 * Git and watcher events may narrow `currentFiles`, but neither decides the
 * result. The filesystem plus stored hash remains authoritative. Persistence
 * effects for removals stay behind `onRemove`, keeping this module independent
 * from the frozen database and Resolution implementations.
 */
export async function reconcileSources(input: ReconciliationInput): Promise<ReconciliationResult> {
  const currentSet = new Set(input.currentFiles);
  const trackedMap = new Map(input.trackedFiles.map((file) => [file.path, file]));
  const filesToIndex: string[] = [];
  const changedFilePaths: string[] = [];
  const failedFilePaths: string[] = [];
  let filesAdded = 0;
  let filesModified = 0;
  let filesRemoved = 0;
  let checks = 0;

  const maybeYield = async () => {
    checks++;
    if (input.yieldEvery && checks % input.yieldEvery === 0) {
      await input.yieldControl?.();
    }
  };

  for (const tracked of input.trackedFiles) {
    if (!currentSet.has(tracked.path) || !input.io.exists(tracked.path)) {
      input.onRemove(tracked);
      filesRemoved++;
    }
    await maybeYield();
  }

  for (const filePath of input.currentFiles) {
    await maybeYield();
    const tracked = trackedMap.get(filePath);

    if (tracked) {
      try {
        const stat = input.io.stat(filePath);
        if (stat.size === tracked.size && Math.floor(stat.mtimeMs) === Math.floor(tracked.modifiedAt)) {
          continue;
        }
      } catch (error) {
        input.onReadFailure?.(filePath, 'stat', error);
        failedFilePaths.push(filePath);
        continue;
      }
    }

    let content: string;
    try {
      content = input.io.read(filePath);
    } catch (error) {
      input.onReadFailure?.(filePath, 'read', error);
      failedFilePaths.push(filePath);
      continue;
    }

    if (!tracked) {
      filesToIndex.push(filePath);
      changedFilePaths.push(filePath);
      filesAdded++;
    } else if (tracked.contentHash !== input.hash(content)) {
      filesToIndex.push(filePath);
      changedFilePaths.push(filePath);
      filesModified++;
    }
  }

  return {
    filesChecked: input.filesChecked,
    filesAdded,
    filesModified,
    filesRemoved,
    filesToIndex,
    changedFilePaths,
    failedFilePaths,
  };
}

/** Definition names whose per-file presence changed during a sync. */
export function definitionDelta(before: ReadonlySet<string>, after: ReadonlySet<string>): string[] {
  const names = new Set<string>();
  const nameOf = (pair: string) => pair.slice(pair.indexOf('\0') + 1);
  for (const pair of before) if (!after.has(pair)) names.add(nameOf(pair));
  for (const pair of after) if (!before.has(pair)) names.add(nameOf(pair));
  return [...names];
}
