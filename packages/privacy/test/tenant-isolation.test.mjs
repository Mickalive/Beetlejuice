import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GLOBAL_BENCHMARK_CONTRIBUTION,
  exportGlobalLearningRecords,
} from "../src/index.js";
import { tenantRecord } from "./helpers/fixtures.js";

const PURPOSE = GLOBAL_BENCHMARK_CONTRIBUTION;

// Fictional tenant markers embedded in raw identity inputs. If any of these
// ever reached the global layer it would constitute cross-tenant leakage.
const MARKER_A = "acme-alpha-workspace";
const MARKER_B = "bravo-beta-workspaces";

test("raw tenant markers in free-text inputs never reach the global export", () => {
  const result = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [
      ...Array.from({ length: 4 }, () => tenantRecord()),
      tenantRecord({ agent_name: `${MARKER_A}-agent`, model_name: `${MARKER_A}-model` }),
    ],
  });
  assert.equal(result.counts.accepted, 5);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("alpha"), "tenant marker leaked");
  assert.ok(!serialized.includes(MARKER_A), "tenant marker leaked");
});

test("two tenants with identical abstract features are indistinguishable", () => {
  const tenantA = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () =>
      tenantRecord({ agent_name: `${MARKER_A}-agent` }),
    ),
  });
  const tenantB = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: Array.from({ length: 5 }, () =>
      tenantRecord({ agent_name: `${MARKER_B}-agent` }),
    ),
  });
  // Byte-identical exports prove no tenant-specific residue exists.
  assert.equal(JSON.stringify(tenantA), JSON.stringify(tenantB));
});

test("exports are stateless: one tenant's batch cannot influence another's", () => {
  const uniqueX = { task_class: "dependency_upgrade", cost_usd: 321.5 };
  const alone = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [tenantRecord(uniqueX)],
  });
  const afterA = exportGlobalLearningRecords({
    purpose: PURPOSE,
    records: [tenantRecord(uniqueX)],
  });

  assert.equal(JSON.stringify(alone), JSON.stringify(afterA));
  assert.equal(alone.counts.suppressed, 1);
});

test("sequential multi-tenant processing leaves no cross-contamination", () => {
  const batchA = Array.from({ length: 5 }, () =>
    tenantRecord({ agent_name: `${MARKER_A}-runner` }),
  );
  const batchB = Array.from({ length: 5 }, () =>
    tenantRecord({ agent_name: `${MARKER_B}-runner` }),
  );

  const first = exportGlobalLearningRecords({ purpose: PURPOSE, records: batchA });
  const second = exportGlobalLearningRecords({ purpose: PURPOSE, records: batchB });

  const secondJson = JSON.stringify(second);
  assert.ok(!secondJson.includes("alpha"));
  assert.ok(!secondJson.includes("beta"));
  assert.ok(!secondJson.includes(MARKER_A));

  // And the first tenant's export was not mutated by the second call.
  const firstAgain = JSON.parse(JSON.stringify(first));
  assert.equal(firstAgain.counts.accepted, 5);
});
