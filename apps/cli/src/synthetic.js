// Loads the bundled deterministic synthetic fixture used by the demo mode.
// The fixture contains canonical normalized agentic_task records only (v2) —
// the same contract a real GitHub adapter must emit after normalization.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FIXTURE_RELATIVE_PATH = "../fixtures/synthetic-audit-v2.json";

export function loadSyntheticFixture() {
  const fixturePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    FIXTURE_RELATIVE_PATH
  );
  const raw = readFileSync(fixturePath, "utf8");
  return JSON.parse(raw);
}

/** Legacy v1 draft fixture kept as migration-test input (never rendered directly). */
export function loadLegacyV1Fixture() {
  const fixturePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../fixtures/legacy-v1/synthetic-audit-v1.json"
  );
  return JSON.parse(readFileSync(fixturePath, "utf8"));
}
