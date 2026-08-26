/**
 * Producer mapping: canonical tenant audit task -> privacy-gate input.
 *
 * This is the tenant-side bridge between the core lane's AGENTIC_TASK audit
 * aggregates (`TenantLedger.audit()` -> `audit.tasks[]`, serialized by
 * `buildCoreAuditExport`) and `normalizeTenantRecord`. It is the ONLY
 * sanctioned way to derive a global-record candidate from real audit data.
 *
 * Design rules:
 *
 * - Extract only numbers, booleans and closed-vocabulary tokens from the
 *   aggregate. Identifiers and free text — task refs, execution refs,
 *   revision keys, PR refs, component refs, equivalence keys, outcome detail
 *   strings, adapter names, timestamps — are NEVER copied through, no matter
 *   how harmless they look. They may contain org/repo/branch/commit data.
 * - Money is integer micro-USD in the canonical model; only components with
 *   `cost.known === true` contribute, mirroring the core's honest handling of
 *   unpriceable work. Unknown-cost components never fabricate a magnitude.
 * - Token totals are derived ONLY when every model invocation reports both
 *   token counters; partial coverage stays "unknown" instead of a guessed
 *   bucket ("expose unknown rather than guess").
 * - Wall-clock durations are intentionally NOT derivable here: the aggregate
 *   carries exact timestamps (`lastTime`) which must never travel toward the
 *   global layer, and per-run CI durations are not task wall-clock time.
 *   Callers may pass an explicit pre-bucketed `duration_bucket` hint if their
 *   tenant policy allows it; otherwise the record stays "unknown".
 * - Semantic classifications that need tenant context (`task_class`,
 *   `language_family`, repo-size/dependency buckets…) arrive as HINTS and are
 *   validated downstream by the gate's allowlist like any other input.
 * - Structural violations throw TypeError (programmer error); content-level
 *   safety is still enforced afterwards by normalizeTenantRecord +
 *   schema-validation + content-defense, so nothing here can admit a value
 *   the gate would reject.
 *
 * Versioned independently of the gate pipeline (it runs tenant-side, before
 * the gate): see AUDIT_MAPPING_VERSION.
 */

/** Micro-USD per USD in the canonical cost model (see @beetlejuice/core). */
const MICROS_PER_USD = 1_000_000;

/** Version of this producer mapping (bump on any behavioral change). */
export const AUDIT_MAPPING_VERSION = "1.0.0";

/** Outcome kinds the canonical model emits on audit aggregates. */
export const AUDIT_OUTCOME_KINDS = Object.freeze([
  "accepted",
  "failed",
  "aborted",
  "unresolved",
]);

/**
 * Abstract terminal CI statuses. The canonical model distinguishes
 * cancelled/timed_out from failed for waste analysis; at global granularity
 * both mean "CI did not pass", so they generalize onto "failed".
 */
const CI_NOT_PASSED = new Set(["failed", "cancelled", "timed_out"]);

const COMPONENT_BUCKETS = Object.freeze([
  "modelInvocations",
  "toolInvocations",
  "computeUsage",
  "ciRuns",
  "validations",
  "humanInterventions",
]);

function assertPlainObject(value, what) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`audit mapping expects ${what} to be a plain object`);
  }
}

function assertNonNegativeInt(value, what) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`audit mapping expects ${what} to be a non-negative integer`);
  }
}

function emptyComponents() {
  return {
    modelInvocations: [],
    toolInvocations: [],
    computeUsage: [],
    ciRuns: [],
    validations: [],
    humanInterventions: [],
  };
}

/**
 * Validate one cost-bearing component and return its known micro-USD amount.
 * Components without measured cost contribute zero (honest absence), but a
 * malformed cost object is a structural error.
 */
function componentMicroUsd(component) {
  assertPlainObject(component, "audit task component");
  const { cost } = component;
  assertPlainObject(cost ?? null, "component cost");
  if (cost.known !== true) return { knownUsdMicros: 0, hasKnownCost: false };
  assertNonNegativeInt(cost.micro_usd, "known component cost.micro_usd");
  return { knownUsdMicros: cost.micro_usd, hasKnownCost: true };
}

function collectComponents(task) {
  const all = [];
  const executions = task.executions ?? [];
  if (!Array.isArray(executions)) {
    throw new TypeError("audit mapping expects executions to be an array");
  }
  for (const execution of executions) {
    assertPlainObject(execution, "execution");
    const components = execution.components ?? emptyComponents();
    assertPlainObject(components, "execution components");
    for (const bucket of COMPONENT_BUCKETS) {
      const list = components[bucket] ?? [];
      if (!Array.isArray(list)) {
        throw new TypeError(`execution components.${bucket} must be an array`);
      }
      all.push(...list);
    }
  }
  const unassigned = task.unassignedComponents ?? emptyComponents();
  assertPlainObject(unassigned, "unassignedComponents");
  for (const bucket of COMPONENT_BUCKETS) {
    const list = unassigned[bucket] ?? [];
    if (!Array.isArray(list)) {
      throw new TypeError(`unassignedComponents.${bucket} must be an array`);
    }
    all.push(...list);
  }
  return all;
}

/**
 * Derive the abstract ci_result from observed CI run payloads.
 * No runs -> undefined (gate default "none" applies).
 */
export function deriveCiResult(ciRuns) {
  if (ciRuns.length === 0) return undefined;
  let passed = 0;
  let notPassed = 0;
  for (const run of ciRuns) {
    const status = run?.payload?.status;
    if (typeof status !== "string") {
      throw new TypeError("ci run payload.status must be a string");
    }
    if (status === "passed") passed += 1;
    else if (CI_NOT_PASSED.has(status)) notPassed += 1;
    else {
      // Unknown terminal status: refuse to guess rather than mislabel.
      throw new TypeError(`unknown ci run status "${status}"`);
    }
  }
  if (passed > 0 && notPassed > 0) return "mixed";
  if (passed > 0) return "passed";
  return "failed";
}

/**
 * Map the conservative canonical outcome onto the global outcome vocabulary.
 * accepted+merged -> pr_merged; accepted but reverted -> revert (never claim
 * acceptance for reverted work); failed -> task_failed (the merged-vs-closed
 * distinction may carry identifiers and stays tenant-local); aborted ->
 * task_aborted; unresolved -> task_started.
 */
export function mapOutcome(outcome) {
  assertPlainObject(outcome, "task.outcome");
  const { kind } = outcome;
  if (!AUDIT_OUTCOME_KINDS.includes(kind)) {
    throw new TypeError(`unknown audit outcome kind "${String(kind)}"`);
  }
  switch (kind) {
    case "accepted":
      return outcome.reverted === true ? "revert" : "pr_merged";
    case "failed":
      return "task_failed";
    case "aborted":
      return "task_aborted";
    default:
      return "task_started";
  }
}

/**
 * Convert one canonical audit task aggregate into a privacy-gate input.
 *
 * @param {object} task audit task aggregate (TenantLedger.audit() shape)
 * @param {Record<string, unknown>} [hints] additional tenant-side inputs
 *        (required semantics like task_class/language_family, or
 *        pre-bucketed values). Hint keys pass through the gate allowlist:
 *        forbidden hint keys make the whole candidate reject downstream.
 * @returns {Record<string, unknown>} normalizeTenantRecord-compatible input
 */
export function mapAuditTaskToPrivacyInput(task, hints = {}) {
  assertPlainObject(task, "audit task");
  assertPlainObject(hints, "hints");

  if (
    typeof task.retries !== "undefined" &&
    !(typeof task.retries === "number" && Number.isInteger(task.retries) && task.retries >= 0)
  ) {
    throw new TypeError("audit task retries must be a non-negative integer");
  }
  if (
    typeof task.humanReworkEvents !== "undefined" &&
    !(
      typeof task.humanReworkEvents === "number" &&
      Number.isInteger(task.humanReworkEvents) &&
      task.humanReworkEvents >= 0
    )
  ) {
    throw new TypeError("audit task humanReworkEvents must be a non-negative integer");
  }

  const components = collectComponents(task);

  // --- money: sum only measured costs ---
  let knownUsdMicros = 0;
  for (const component of components) {
    knownUsdMicros += componentMicroUsd(component).knownUsdMicros;
  }

  // --- counts ---
  const toolInvocations = components.filter((c) => c?.kind === "tools");
  const modelInvocations = components.filter((c) => c?.kind === "inference");
  const ciRuns = components.filter((c) => c?.kind === "ci");
  const humanInterventions = components.filter((c) => c?.kind === "human");

  // --- tokens: only complete coverage derives a total ---
  let tokensTotal;
  if (modelInvocations.length > 0) {
    let sum = 0;
    let complete = true;
    for (const invocation of modelInvocations) {
      const payload = invocation.payload ?? {};
      const tin = payload.tokens_in;
      const tout = payload.tokens_out;
      if (
        typeof tin !== "number" || !Number.isInteger(tin) || tin < 0 ||
        typeof tout !== "number" || !Number.isInteger(tout) || tout < 0
      ) {
        complete = false;
        break;
      }
      sum += tin + tout;
    }
    if (complete) tokensTotal = sum;
  }

  /** @type {Record<string, unknown>} */
  const input = {};
  if (knownUsdMicros > 0) input.cost_usd = knownUsdMicros / MICROS_PER_USD;
  if (tokensTotal !== undefined) input.tokens_total = tokensTotal;
  input.tool_calls = toolInvocations.length;
  input.retry_count = task.retries ?? 0;
  input.human_intervention =
    (task.humanReworkEvents ?? 0) > 0 || humanInterventions.length > 0;

  const ciResult = deriveCiResult(ciRuns);
  if (ciResult !== undefined) input.ci_result = ciResult;
  input.outcome = mapOutcome(task.outcome);

  // Hints win over derived values (tenant context beats coarse derivation);
  // the gate validates every key/value downstream regardless.
  return { ...input, ...hints };
}
