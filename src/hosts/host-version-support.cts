/** Runtime-self-contained JX3 support frozen from build-time verified PASS receipts. */

import type { HostId } from "../core/contracts.cjs";

export interface HostVersionSupportRow {
  readonly host: HostId;
  readonly version: string;
  readonly receiptPath: string;
  readonly receiptDigest: string;
}

export interface HostVersionSupportResult {
  readonly navigation: true;
  readonly jx3StyleNudge: boolean;
  readonly code?: "host_version_unsupported";
  readonly receiptDigest?: string;
}

export const HOST_VERSION_SUPPORT_ROWS: readonly HostVersionSupportRow[] = Object.freeze([
  Object.freeze({
    host: "claude" as const,
    version: "2.1.241",
    // Build-time fixture tests bind this audit locator to the frozen digest below.
    receiptPath: "fixtures/host-delivery/claude-2.1.241.json",
    receiptDigest: "bb00429dbca08a026604c6f2aeeac988d757fbe10751a92ed7b7d7c2093bd119",
  }),
]);

export function evaluateHostVersionSupport(
  host: HostId,
  version: string,
  repositoryRoot?: string,
): HostVersionSupportResult {
  // Kept as a compatibility-only parameter; runtime support never reads repository evidence.
  void repositoryRoot;
  const row = HOST_VERSION_SUPPORT_ROWS.find((candidate) =>
    candidate.host === host && candidate.version === version);
  if (row !== undefined) {
    return Object.freeze({
      navigation: true as const,
      jx3StyleNudge: true,
      receiptDigest: row.receiptDigest,
    });
  }
  return Object.freeze({
    navigation: true as const,
    jx3StyleNudge: false,
    code: "host_version_unsupported" as const,
  });
}

exports.HOST_VERSION_SUPPORT_ROWS = HOST_VERSION_SUPPORT_ROWS;
exports.evaluateHostVersionSupport = evaluateHostVersionSupport;
