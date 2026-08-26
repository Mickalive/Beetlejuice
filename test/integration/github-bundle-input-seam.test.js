// Integration e2e (audit finding A7 closure): the product surface's `--input`
// seam must accept a bundle produced by the REAL GitHub adapter producer.
//
// History: two independent `buildNormalizedBundle` implementations now exist —
// @beetlejuice/github's (adapter side) and apps/cli/src/bundle.js (generic
// helper). Audit cycle 32931221589 proved by execution that genuine adapter
// output was REJECTED by the CLI (finding E23/A7). This committed test pins
// the repaired seam so drift between the two producers can never silently
// recur in CI:
//
//   @beetlejuice/github fixture evidence -> github.buildNormalizedBundle()
//     -> JSON file -> apps/cli runCli(["--input", file])
//     -> exit 0 + economics-first report labeled normalized-input.
//
// Lane hermeticity: when sibling packages are absent (single-lane checkout)
// the cross-package assertions SKIP explicitly; the presence probe still runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let github = null;
let loadError = null;
try {
  github = await import("@beetlejuice/github");
} catch (error) {
  loadError = error;
}

/** Capture process.stdout.write output of an async fn (runCli prints this way). */
async function captureStdout(fn) {
  const chunks = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    const code = await fn();
    return { code, stdout: chunks.join("") };
  } finally {
    process.stdout.write = original;
  }
}

test("github adapter bundle producer is mounted or its absence is explicit", () => {
  if (github !== null) {
    assert.equal(typeof github.buildNormalizedBundle, "function");
  } else {
    assert.equal(loadError?.code ?? "ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND");
    console.log("[skip] @beetlejuice/github not mounted; adapter->CLI bundle seam executes on integrated trees only");
  }
});

test(
  "adapter-produced v2 bundle renders through the CLI --input seam (A7 regression)",
  { skip: github === null ? "@beetlejuice/github not mounted on this lane checkout" : false },
  async () => {
    // Repo-relative import: the adapter's exports map intentionally exposes
    // only its public surface; test fixtures stay internal to the lane.
    const fx = await import("../../packages/github/test/fixtures/synthetic-repo.js");

    // Producer side: the ADAPTER builds the envelope from collected evidence,
    // with measured CI cost where an operator-supplied cost source resolves it.
    const bundle = github.buildNormalizedBundle(fx.fixtureEvidence(), {
      costSource: github.actionsUsageCostSource({
        usageByAttempt: fx.fixtureUsageRecords(),
        rateUsdPerMinute: fx.FIXTURE_RATE_USD_PER_MINUTE,
      }),
    });
    assert.equal(bundle.schema_version, "2");
    assert.ok(bundle.records.length >= 1);

    const dir = mkdtempSync(join(tmpdir(), "bj-a7-"));
    const bundlePath = join(dir, "bundle.json");
    writeFileSync(bundlePath, JSON.stringify(bundle));

    // Consumer side: exactly what `npm run demo -- --input <file>` runs.
    const { runCli } = await import("../../apps/cli/src/demo.js");
    const { code, stdout } = await captureStdout(() => runCli(["--input", bundlePath]));

    assert.equal(code, 0, "genuine adapter output must be accepted by the product surface");
    assert.match(stdout, /# Beetlejuice Audit — Agentic Economics Report/);
    assert.match(stdout, /normalized-input mode/);
    // Measured CI money from the operator cost source flows through verbatim.
    assert.match(stdout, /\$0\.232/, "known $0.232 spend must appear as measured cost");
    assert.match(stdout, /Successful outcomes/);
    // Tokens stay secondary diagnostics; economics lead.
    const headline = stdout.split("## Certain-waste findings")[0];
    assert.doesNotMatch(headline, /token/i);
  }
);
