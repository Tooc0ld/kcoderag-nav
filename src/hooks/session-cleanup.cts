#!/usr/bin/env node
/** Receipt-gated exact-lane cleanup for code-style once claims; unsupported events retain markers. */

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

import type { HostId } from "../core/contracts.cjs";
import {
  nudgeMarkerKey,
  stableSessionIdentity,
  type OnceMarkerScope,
  type StableSessionField,
} from "./once-marker.cjs";

const MAX_INPUT_CHARS = 131_072;

export interface SessionCleanupOptions extends OnceMarkerScope {
  readonly cacheRoot: string;
  readonly receiptProvesSessionEnd?: (
    host: HostId,
    field: StableSessionField,
  ) => boolean;
  readonly remove?: (filePath: string) => boolean;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** No checked-in delivery receipt currently proves stable-identity SessionEnd parity. */
export function sessionEndCleanupProven(_host: HostId): boolean {
  return false;
}

function removeExactFile(filePath: string): boolean {
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function cleanupSessionClaim(
  payload: unknown,
  options: SessionCleanupOptions,
): boolean {
  try {
    if (!isRecord(payload) || payload.hook_event_name !== "SessionEnd") return false;
    const identity = stableSessionIdentity(payload);
    if (identity === undefined) return false;
    const isProven = options.receiptProvesSessionEnd ??
      ((host: HostId): boolean => sessionEndCleanupProven(host));
    if (!isProven(options.host, identity.field)) return false;
    const key = nudgeMarkerKey(payload, options);
    if (key === undefined) return false;
    const markerPath = path.join(path.resolve(options.cacheRoot), "nudges", `${key}.claim`);
    return (options.remove ?? removeExactFile)(markerPath);
  } catch {
    return false;
  }
}

function readBoundedStdin(): string {
  const chunks: Buffer[] = [];
  let total = 0;
  while (total <= MAX_INPUT_CHARS) {
    const buffer = Buffer.allocUnsafe(Math.min(8_192, MAX_INPUT_CHARS + 1 - total));
    const count = fs.readSync(0, buffer, 0, buffer.length, null);
    if (count === 0) break;
    chunks.push(buffer.subarray(0, count));
    total += count;
  }
  return total > MAX_INPUT_CHARS ? "" : Buffer.concat(chunks, total).toString("utf8");
}

export function main(rawInput?: string): number {
  try {
    const raw = rawInput ?? readBoundedStdin();
    if (raw.length === 0 || raw.length > MAX_INPUT_CHARS) return 0;
    JSON.parse(raw) as unknown;
  } catch {
    return 0;
  }
  return 0;
}

if (require.main === module) process.exitCode = main();
