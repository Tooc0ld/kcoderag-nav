#!/usr/bin/env node
/** Detached, bounded npm Registry update-cache worker. */

export interface RefreshOptions {
  readonly cacheRoot: string;
  readonly now?: () => number;
  readonly request?: (...args: readonly unknown[]) => Promise<unknown>;
  readonly writeCache?: (...args: readonly unknown[]) => Promise<void>;
}

export async function refreshLatest(_options: RefreshOptions): Promise<boolean> {
  return false;
}

export async function main(_argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  return 0;
}

if (require.main === module) {
  void main().then((exitCode) => { process.exitCode = exitCode; }).catch(() => { process.exitCode = 0; });
}
