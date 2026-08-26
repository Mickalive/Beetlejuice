import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeEconomics } from "../src/economics.js";
import { validateNormalizedBundle } from "../src/schema.js";
import { loadSyntheticFixture } from "../src/synthetic.js";

function fixtureSummary() {
  return summarizeEconomics(validateNormalizedBundle(loadSyntheticFixture()).records);
}

test("measured / estimated / unavailable bases are separated exactly (integer micro-USD)", () => {
  const s = fixtureSummary();
  assert.equal(s.cost.measured_micro_usd, 28_570_000); // $28.57
  assert.equal(s.cost.estimated_micro_usd, 1_600_000); // $1.60 (T-006 inference)
  assert.equal(s.cost.representable_total_micro_usd, 30_170_000); // $30.17
  assert.equal(s.cost.unavailable_components, 1); // T-006 ci has no billing evidence
  assert.equal(s.cost.unit, "micro_usd");
});

test("outcome counts use the canonical attribution vocabulary", () => {
  const s = fixtureSummary();
  assert.deepEqual(s.tasks, {
    total: 6,
    accepted: 2,
    unresolved: 1,
    failed: 1,
    aborted: 2,
  });
  assert.equal(s.outcomes.successful, 2);
  assert.equal(s.outcomes.success_status, "accepted");
});

test("cost per successful outcome follows its stated formula (exact value preserved)", () => {
  const s = fixtureSummary();
  // representable spend 30_170_000µ$ ÷ 2 accepted = 15_085_000µ$ ($15.085 exact; $15.09 displayed half-up)
  assert.equal(s.outcomes_economics.cost_per_successful_outcome_micro_usd, 15_085_000);
  assert.match(s.outcomes_economics.formula, /representable_total_micro_usd/);
});

test("data-quality breakdown per component reconciles with totals", () => {
  const s = fixtureSummary();
  const dq = s.data_quality_by_component;
  assert.deepEqual(dq.inference.measured, { count: 12, micro_usd: 19_350_000 });
  assert.deepEqual(dq.inference.estimated, { count: 1, micro_usd: 1_600_000 });
  assert.deepEqual(dq.tools.measured, { count: 13, micro_usd: 3_020_000 });
  assert.deepEqual(dq.ci.measured, { count: 10, micro_usd: 5_100_000 });
  assert.equal(dq.ci.unavailable.count, 1);
  assert.deepEqual(dq.compute.measured, { count: 13, micro_usd: 1_100_000 });
  const sum =
    dq.inference.measured.micro_usd +
    dq.inference.estimated.micro_usd +
    dq.tools.measured.micro_usd +
    dq.ci.measured.micro_usd +
    dq.compute.measured.micro_usd;
  assert.equal(sum, s.cost.representable_total_micro_usd);
});

test("analysis period derives from observed task timestamps", () => {
  const s = fixtureSummary();
  assert.equal(s.period.from_iso, "2026-08-03T09:00:00.000Z");
  assert.equal(s.period.to_iso, "2026-08-13T09:50:00.000Z");
});

test("no successful outcomes -> cost per successful outcome is null, not guessed", () => {
  const summary = summarizeEconomics([
    {
      record_type: "agentic_task",
      task_id: "X-1",
      started_at: "2026-08-01T00:00:00Z",
      outcome: { status: "failed" },
      executions: [
        {
          execution_id: "xe-1",
          agent: { family: "coding-agent", model_class: "frontier" },
          started_at: "2026-08-01T00:00:00Z",
          components: { inference: { amount_micro_usd: 100_000, basis: "measured" } },
          total_amount_micro_usd: 100_000,
        },
      ],
    },
  ]);
  assert.equal(summary.outcomes.successful, 0);
  assert.equal(summary.outcomes_economics.cost_per_successful_outcome_micro_usd, null);
});
