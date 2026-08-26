/** Exact JX3 host support derived only from frozen PASS receipt digests. */

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

import type { HostId } from "../core/contracts.cjs";
import {
  receiptDigest,
  verifyReceiptFile,
  type HostDeliveryReceipt,
} from "../fixtures/host-delivery.cjs";

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
    receiptPath: "fixtures/host-delivery/claude-2.1.241.json",
    receiptDigest: "bb00429dbca08a026604c6f2aeeac988d757fbe10751a92ed7b7d7c2093bd119",
  }),
]);

function isContainedReceipt(repositoryRoot: string, relativePath: string): string | undefined {
  try {
    const root = fs.realpathSync(repositoryRoot);
    const absolutePath = path.resolve(root, ...relativePath.split("/"));
    const relative = path.relative(root, absolutePath);
    if (relative.length === 0 || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return undefined;
    }
    return absolutePath;
  } catch {
    return undefined;
  }
}

function validatedRowReceipt(
  row: HostVersionSupportRow,
  repositoryRoot: string,
): HostDeliveryReceipt | undefined {
  const receiptPath = isContainedReceipt(repositoryRoot, row.receiptPath);
  if (receiptPath === undefined) return undefined;
  try {
    const receipt = verifyReceiptFile(receiptPath, true);
    if (receipt.host !== row.host || receipt.version !== row.version || receiptDigest(receipt) !== row.receiptDigest) {
      return undefined;
    }
    return receipt;
  } catch {
    return undefined;
  }
}

export function evaluateHostVersionSupport(
  host: HostId,
  version: string,
  repositoryRoot: string = path.resolve(__dirname, "../.."),
): HostVersionSupportResult {
  const row = HOST_VERSION_SUPPORT_ROWS.find((candidate) =>
    candidate.host === host && candidate.version === version);
  if (row !== undefined && validatedRowReceipt(row, repositoryRoot) !== undefined) {
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
