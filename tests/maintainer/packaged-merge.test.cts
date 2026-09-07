import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const acceptance = require("../../dist/maintainer/acceptance-workflow.cjs") as {
  PACKAGED_GROUPS: Record<string, readonly string[]>;
  mergePackagedGroups(values: readonly unknown[], expected: object): { verdict: string; receipts: readonly { host: string }[] };
};
const smoke = require("../../dist/smoke/host-smoke.cjs") as {
  evaluateHostEvidence(input: object): { receipt: Record<string, unknown> };
  EVIDENCE_KEYS: readonly string[];
};
const expected = { candidateSha: "b".repeat(40), packageSha256: "a".repeat(64), memberCount: 100, workflowRunId: "123-2" };

function groups(): Record<string, any>[] {
  return Object.entries(acceptance.PACKAGED_GROUPS).map(([group, hosts]) => ({
    schemaVersion: 1, group, lane: "windows-node22", evidenceLevel: "PACKAGED", verdict: "PASS",
    receipts: hosts.map((host) => ({ ...smoke.evaluateHostEvidence({ host, mode: "required-contract",
      evidence: Object.fromEntries(smoke.EVIDENCE_KEYS.map((key) => [key, true])) }).receipt,
    ...expected, memberCount: undefined,
    packageMemberDigest: createHash("sha256").update(`${expected.packageSha256}:${expected.memberCount}`).digest("hex"),
    artifactDigest: expected.packageSha256, os: "windows", nodeVersion: "22",
    })),
  })).map((group) => JSON.parse(JSON.stringify(group)) as Record<string, any>);
}

test("two packaged groups close exactly five hosts and tolerate artifact download order", () => {
  const merged = acceptance.mergePackagedGroups(groups().reverse(), expected);
  assert.equal(merged.verdict, "PASS");
  assert.deepEqual(merged.receipts.map((receipt) => receipt.host), ["codex", "claude", "cursor", "opencode", "zcode"]);
});

test("packaged merge rejects missing duplicate failed secret-bearing and mixed-identity receipts", () => {
  const valid = groups();
  for (const invalid of [[], [valid[0]], [valid[0], valid[0]]]) {
    assert.throws(() => acceptance.mergePackagedGroups(invalid, expected));
  }
  for (const [key, value] of Object.entries({ candidateSha: "c".repeat(40), packageSha256: "d".repeat(64),
    workflowRunId: "123-1", packageMemberDigest: "e".repeat(64), evidenceLevel: "LIVE", nodeVersion: "24", os: "linux",
    host: "claude", status: "NOT_RUN" })) {
    const changed = groups();
    changed[0]!.receipts[0][key] = value;
    assert.throws(() => acceptance.mergePackagedGroups(changed, expected), key);
  }
  for (const mutate of [
    (group: Record<string, any>) => { group.receipts.pop(); },
    (group: Record<string, any>) => { group.verdict = "FAIL"; },
    (group: Record<string, any>) => { group.token = "fixture"; },
  ]) {
    const changed = groups();
    mutate(changed[0]!);
    assert.throws(() => acceptance.mergePackagedGroups(changed, expected));
  }
});
