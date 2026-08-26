// A7 seam advancement: the documented v2 normalized-bundle contract gains a
// committed PRODUCER-side implementation. These tests pin its guarantees:
//
//  1. round trip — whatever buildNormalizedBundle() emits passes the exact
//     validator consumers run, and flows through the full report pipeline;
//  2. refusal — records that would fail validation (broken accounting
//     invariant, raw provider payloads, empty sets) never become envelopes;
//  3. provenance — collector/normalization versions are mandatory and travel
//     into every rendered report.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNormalizedBundle, BUNDLE_BUILDER_VERSION } from "../src/bundle.js";
import { validateNormalizedBundle } from "../src/schema.js";
import { buildAuditReport } from "../src/audit.js";
import { renderMarkdownReport, renderJsonReport } from "../src/report/markdown.js";
import { loadSyntheticFixture } from "../src/synthetic.js";

test("producer helper version is declared", () => {
  assert.equal(BUNDLE_BUILDER_VERSION, "1.0.0");
});

test("round trip: adapter records -> envelope -> validator -> full report", () => {
  const records = loadSyntheticFixture().records;
  const bundle = buildNormalizedBundle(records, {
    collector_version: "adapter-under-test-2.1.0",
    normalization_version: "3",
  });

  // The emitted envelope passes the consumer validator unchanged.
  const validation = validateNormalizedBundle(bundle);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
  assert.equal(validation.records.length, records.length);

  // Envelope shape and provenance are exactly the documented contract.
  assert.equal(bundle.schema_version, "2");
  assert.equal(bundle.collector_version, "adapter-under-test-2.1.0");
  assert.equal(bundle.normalization_version, "3");

  // Full user journey works off produced data: report + deterministic render.
  const report = buildAuditReport(bundle, { mode: "normalized-input" });
  const json = JSON.parse(renderJsonReport(report));
  assert.equal(json.provenance.collector_version, "adapter-under-test-2.1.0");
  assert.equal(json.headline.agentic_tasks_total, 6);
  assert.equal(json.headline.total_measured_cost_micro_usd, 28_570_000);
  assert.match(renderMarkdownReport(report), /\$28\.57/);

  // Deterministic producer output.
  const again = buildNormalizedBundle(records, {
    collector_version: "adapter-under-test-2.1.0",
    normalization_version: "3",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(bundle)), JSON.parse(JSON.stringify(again)));
});

test("refuses records violating the cost accounting invariant (with typed errors)", () => {
  const records = structuredClone(loadSyntheticFixture()).records;
  records[0].executions[0].total_amount_micro_usd += 1; // break components==total
  try {
    buildNormalizedBundle(records, { collector_version: "x-1.0.0" });
    assert.fail("expected throw");
  } catch (error) {
    assert.equal(error.code, "INVALID_NORMALIZED_RECORDS");
    assert.ok(Array.isArray(error.validation_errors) && error.validation_errors.length > 0);
    assert.match(error.message, /invariant|invalid envelope/i);
  }
});

test("refuses raw provider payloads — adapters must normalize first", () => {
  const records = structuredClone(loadSyntheticFixture()).records;
  records[0].executions[0].workflow_run = { id: 12345 };
  assert.throws(
    () => buildNormalizedBundle(records, { collector_version: "x-1.0.0" }),
    /normalize/i
  );
});

test("requires provenance: collector_version and normalization_version", () => {
  const records = loadSyntheticFixture().records;
  assert.throws(() => buildNormalizedBundle(records, {}), /collector_version/);
  assert.throws(
    () => buildNormalizedBundle(records, { collector_version: "x-1.0.0", normalization_version: "" }),
    /normalization_version/
  );
  assert.throws(() => buildNormalizedBundle([], { collector_version: "x-1.0.0" }), /at least one/);
  assert.throws(() => buildNormalizedBundle("nope", { collector_version: "x-1.0.0" }), /array/);
});
