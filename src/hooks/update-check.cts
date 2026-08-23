#!/usr/bin/env node
/** Foreground-only update cache reader and detached refresh scheduler. */

export const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
export const MAX_SESSION_MARKERS = 128;

export interface UpdateCheckFiles {
  readText(filePath: string): string | undefined;
  ensureDirectory(directoryPath: string): void;
  createExclusive(filePath: string, contents: string): boolean;
  listFiles(directoryPath: string): readonly { readonly name: string; readonly mtimeMs: number }[];
  remove(filePath: string): void;
}

export interface UpdateCheckOptions {
  readonly cacheRoot?: string;
  readonly now?: () => number;
  readonly files?: UpdateCheckFiles;
  readonly spawn?: (...args: readonly unknown[]) => { unref?(): void };
  readonly workerPath?: string;
}

export function readUpdateHint(
  _installedVersion: string | undefined,
  _options: UpdateCheckOptions = {},
): string | undefined {
  return undefined;
}

export function scheduleRefresh(
  _hookPayload: unknown,
  _options: UpdateCheckOptions = {},
): boolean {
  return false;
}
