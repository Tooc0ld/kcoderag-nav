import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";

const smoke = require("../../dist/smoke/host-smoke.cjs") as {
  packagedHostGroups(hosts: readonly string[]): readonly (readonly string[])[];
  validatePackagedWorkerResult(value: unknown, hosts: readonly string[], provenance: object): readonly unknown[];
  evaluateHostEvidence(input: object): Record<string, unknown>;
  EVIDENCE_KEYS: readonly string[];
  runPackagedWorker(request: object, provenance: object, launch: () => ChildProcess, timeoutMs?: number): Promise<readonly unknown[]>;
};
const hosts = ["codex", "claude", "cursor", "opencode", "zcode"];
const provenance = {
  requestedPackageSpec: "readiness-artifact", expectedVersion: "0.3.6",
  resolvedPackageName: "kcoderag-nav", resolvedVersion: "0.3.6",
  lifecycleTarballSha256: "a".repeat(64), artifactMemberCount: 100,
};

function result(host: string): Record<string, unknown> {
  return smoke.evaluateHostEvidence({ host, mode: "required-contract", provenance,
    evidence: Object.fromEntries(smoke.EVIDENCE_KEYS.map((key) => [key, true])) });
}

test("packaged groups cover each requested host exactly once with at most two workers", () => {
  const groups = smoke.packagedHostGroups(hosts);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.flat().sort(), [...hosts].sort());
  assert.deepEqual(smoke.packagedHostGroups(["codex"]), [["codex"]]);
  for (const invalid of [[], ["codex", "codex"], ["unknown"]]) {
    assert.throws(() => smoke.packagedHostGroups(invalid));
  }
});

test("worker receipt collection refuses missing, duplicate, wrong-host and wrong-artifact results", () => {
  const valid = [result("codex"), result("claude")];
  assert.equal(smoke.validatePackagedWorkerResult(valid, ["codex", "claude"], provenance).length, 2);
  for (const invalid of [null, [], [valid[0]], [valid[0], valid[0]], [...valid].reverse(),
    [{ ...valid[0], provenance: { ...provenance, artifactMemberCount: 101 } }, valid[1]],
    [{ ...valid[0], evidence: {} }, valid[1]],
    [{ ...valid[0], evidenceLevel: "LIVE" }, valid[1]],
    [{ ...valid[0], receipt: { ...(valid[0]?.receipt as object), status: "NOT_RUN" } }, valid[1]]]) {
    assert.throws(() => smoke.validatePackagedWorkerResult(invalid, ["codex", "claude"], provenance));
  }
});

test("failed packaged host remains failed after worker collection", () => {
  const failed = smoke.evaluateHostEvidence({ host: "codex", mode: "required-contract", provenance,
    failureReason: "install_failed" });
  const collected = smoke.validatePackagedWorkerResult([failed], ["codex"], provenance) as readonly Record<string, unknown>[];
  assert.equal(collected[0]?.status, "FAIL");
});

test("worker nonzero exit, missing result, duplicate result and timeout fail closed", async () => {
  const request = { hosts: ["codex"] };
  const value = JSON.stringify([result("codex")]);
  for (const body of [
    "process.exit(1)",
    "process.disconnect()",
    `process.send(${value}, () => process.exit(1))`,
    `process.send(${value}); process.send(${value}, () => process.disconnect())`,
    "setInterval(() => {}, 1000)",
  ]) {
    await assert.rejects(smoke.runPackagedWorker(request, provenance, () => spawn(process.execPath,
      ["-e", `process.once('message', () => { ${body} });`], {
        stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true,
      }), 1500));
  }
});
