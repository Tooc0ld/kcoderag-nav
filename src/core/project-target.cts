/** Explicit project-target and adapter-declared managed-path validation. */

const fs = require("node:fs") as typeof import("node:fs");
const path = require("node:path") as typeof import("node:path");

import { InstallError, type ProjectTarget, type ValidatedPath } from "./contracts.cjs";

const validatedTargets = new WeakSet<object>();

function isRootPath(candidate: string): boolean {
  return candidate === path.parse(candidate).root;
}

function isAbsoluteOnAnyPlatform(candidate: string): boolean {
  return path.posix.isAbsolute(candidate) || path.win32.isAbsolute(candidate);
}

function validateRelativeSyntax(relativePath: string): readonly string[] {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    isAbsoluteOnAnyPlatform(relativePath)
  ) {
    throw new InstallError("outside_managed_roots", relativePath);
  }
  const parts = relativePath.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new InstallError("path_escape", relativePath);
  }
  return parts;
}

function normalizedManagedRoots(managedRoots: readonly string[]): readonly string[] {
  const result = [...new Set(managedRoots)];
  if (result.length === 0) throw new InstallError("invalid_managed_roots");
  for (const root of result) validateRelativeSyntax(root);
  return result.sort((left, right) => left.localeCompare(right));
}

export function resolveProjectTarget(rawTarget: string, cwd = process.cwd()): ProjectTarget {
  const candidate = path.resolve(cwd, rawTarget);
  let metadata: import("node:fs").Stats;
  try {
    metadata = fs.lstatSync(candidate);
  } catch {
    throw new InstallError("invalid_target");
  }
  if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape");
  if (!metadata.isDirectory()) throw new InstallError("invalid_target");

  let canonical: string;
  try {
    canonical = fs.realpathSync(candidate);
  } catch {
    throw new InstallError("invalid_target");
  }
  if (isRootPath(canonical)) throw new InstallError("unsafe_target");

  const target = Object.freeze({ root: canonical });
  validatedTargets.add(target);
  return target;
}

export function isProjectTarget(value: unknown): value is ProjectTarget {
  return typeof value === "object" && value !== null && validatedTargets.has(value);
}

export function validateManagedPath(
  target: ProjectTarget,
  relativePath: string,
  managedRoots: readonly string[],
): ValidatedPath {
  if (!isProjectTarget(target)) throw new InstallError("invalid_target");
  const parts = validateRelativeSyntax(relativePath);
  const roots = normalizedManagedRoots(managedRoots);
  if (!roots.some((root) => relativePath === root || relativePath.startsWith(`${root}/`))) {
    throw new InstallError("outside_managed_roots", relativePath);
  }

  const absolutePath = path.resolve(target.root, ...parts);
  const relation = path.relative(target.root, absolutePath);
  if (relation.length === 0 || relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new InstallError("path_escape", relativePath);
  }

  let current = target.root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let metadata: import("node:fs").Stats;
    try {
      metadata = fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new InstallError("unreadable", relativePath);
    }
    if (metadata.isSymbolicLink()) throw new InstallError("symlink_escape", relativePath);
    const isDestination = index === parts.length - 1;
    if ((!isDestination && !metadata.isDirectory()) || (isDestination && !metadata.isFile())) {
      throw new InstallError("special_file", relativePath);
    }
  }

  return Object.freeze({ relativePath, absolutePath });
}
