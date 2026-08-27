/** Stable host adapter registry used by both interactive and explicit CLI selection. */

import { InstallError, type HostId } from "../core/contracts.cjs";
import { claudeAdapter } from "./claude.cjs";
import { codexAdapter } from "./codex.cjs";
import { cursorAdapter } from "./cursor.cjs";
import { opencodeAdapter } from "./opencode.cjs";
import { zcodeAdapter } from "./zcode.cjs";
import type { HostAdapter } from "./host-adapter.cjs";

export const HOST_ADAPTERS: readonly HostAdapter[] = Object.freeze([
  codexAdapter,
  claudeAdapter,
  cursorAdapter,
  opencodeAdapter,
  zcodeAdapter,
]);

const BY_HOST = new Map<HostId, HostAdapter>(
  HOST_ADAPTERS.map((adapter) => [adapter.id, adapter]),
);

export function getHostAdapter(host: HostId): HostAdapter {
  const adapter = BY_HOST.get(host);
  if (adapter === undefined) throw new InstallError("unsupported_host");
  return adapter;
}
