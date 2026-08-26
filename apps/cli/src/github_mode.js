// Real GitHub read-only audit mode (audit finding A11; P0 criterion #7).
//
// ONE committed command turns `token + owner/repo` into a full
// economics-first report, using the canonical-core seam (seam B) that the
// committed cross-package e2e already exercises:
//
//   @beetlejuice/github collectHistory (strictly GET, least privilege)
//     -> assembleAudit() -> @beetlejuice/core TenantLedger.appendAll()
//     -> ledger.exportCoreAudit() -> THIS surface's buildReportFromCoreAudit()
//
// Economics stay in packages/core — the surface never recomputes them. The
// mode is mutually exclusive with the synthetic demo and the other ingestion
// seams, and every report produced this way is explicitly labeled
// `real-github-read-only` so demo output can never be mistaken for a real
// repository audit.
//
// Honesty rules:
//   - no token -> exit-code 2 refusal with setup instructions (never a fake
//     or empty audit);
//   - adapter/core packages missing -> honest exit 2 (this surface has zero
//     static runtime dependencies by design);
//   - upstream/transport failures propagate verbatim as GithubAdapterError
//     messages (credential material redacted by the adapter) with exit code 3;
//   - `fetchImpl` injection exists ONLY for tests/simulation; the CLI itself
//     always uses the real network transport.
//
// Classification policy (audit A12): the adapter refuses to GUESS which pull
// requests are agentic — `collectHistory()` requires an explicit policy. This
// surface resolves one for the operator, in order of precedence:
//   1. explicit `policy` parameter (programmatic callers; tests);
//   2. BEETLEJUICE_BOT_ACTORS / BEETLEJUICE_BRANCH_PREFIXES env vars
//      (comma-separated; `-` disables a dimension explicitly);
//   3. a DOCUMENTED conservative default: the adapter's exported
//      SUGGESTED_AGENTIC_ACTORS plus well-known coding-agent branch prefixes.
// The effective policy and its provenance are disclosed in every report so a
// "measured" vs "inferred" classification is never silent.
import { buildReportFromCoreAudit } from "./audit.js";

/** Env var carrying a fine-grained personal access token or App user token. */
export const GITHUB_TOKEN_ENV = "BEETLEJUICE_GITHUB_TOKEN";

/** Env var: comma-separated bot actor logins counted as measured-agentic. */
export const BOT_ACTORS_ENV = "BEETLEJUICE_BOT_ACTORS";

/** Env var: comma-separated branch prefixes counted as inferred-agentic. */
export const BRANCH_PREFIXES_ENV = "BEETLEJUICE_BRANCH_PREFIXES";

/**
 * Well-known coding-agent branch prefixes used ONLY when the operator supplies
 * none via ${BRANCH_PREFIXES_ENV}. Deliberately narrow tool-owned prefixes —
 * generic prefixes ("feature/", "agent/") are excluded because they routinely
 * carry human work. Operators SHOULD override via env for accuracy; matches on
 * prefixes are labeled confidence "inferred" in every downstream report.
 */
export const DEFAULT_AGENTIC_BRANCH_PREFIXES = Object.freeze([
  "beetlejuice/",
  "codex/",
  "copilot/",
  "cursor/",
  "devin-",
  "devin/",
  "jules/",
]);

/** Provenance vocabulary for the effective policy disclosure. */
export const POLICY_SOURCE_EXPLICIT = "explicit-parameter";
export const POLICY_SOURCE_OPERATOR_ENV = "operator-env";
export const POLICY_SOURCE_ADAPTER_SUGGESTED = "adapter-suggested-default";
export const POLICY_SOURCE_PRODUCT_DEFAULT = "product-default";

/** Typed configuration error so the CLI can exit 2 instead of exit 3. */
function policyEnvError(message) {
  const error = new TypeError(message);
  error.code = "GITHUB_POLICY_ENV_INVALID";
  return error;
}

/**
 * Parse one comma-separated env list.
 *
 * - unset / empty / whitespace-only -> null (caller applies its default);
 *   an accidentally blank variable must NOT silently produce an ingests-
 *   nothing policy;
 * - "-" -> [] (explicitly disable this dimension);
 * - otherwise trimmed entries; whitespace inside an entry is rejected
 *   (fail-loud misconfiguration, matching parseOwnerRepo discipline).
 *
 * @param {string | undefined} raw raw env value
 * @param {string} envName env var name for error messages
 * @returns {string[] | null}
 */
export function parseOperatorList(raw, envName) {
  if (raw === undefined || raw === null || raw.trim().length === 0) return null;
  if (raw.trim() === "-") return [];
  const entries = [];
  for (const segment of raw.split(",")) {
    const entry = segment.trim();
    if (entry.length === 0) continue; // tolerate trailing/adjacent commas
    if (/\s/.test(entry)) {
      throw policyEnvError(
        `${envName} entries must be single tokens without whitespace (got "${entry}")`
      );
    }
    entries.push(entry);
  }
  return entries;
}

/**
 * Resolve the effective operator classification policy WITHOUT network I/O.
 *
 * @param {object} [opts]
 * @param {object} [opts.env]                 env source (defaults to process.env)
 * @param {string[]} [opts.suggestedActors]   adapter-exported SUGGESTED_AGENTIC_ACTORS
 *                                            (injected by runGithubReadOnly once the
 *                                            sibling package is mounted)
 * @returns {{ policy: { botActors: string[], branchPrefixes: string[] }, sources: object }}
 */
export function resolveOperatorPolicy({ env = process.env, suggestedActors = [] } = {}) {
  if (!Array.isArray(suggestedActors)) {
    throw policyEnvError("suggestedActors must be an array of bot login strings");
  }
  const actorsFromEnv = parseOperatorList(env[BOT_ACTORS_ENV], BOT_ACTORS_ENV);
  const prefixesFromEnv = parseOperatorList(env[BRANCH_PREFIXES_ENV], BRANCH_PREFIXES_ENV);
  const policy = Object.freeze({
    botActors: Object.freeze(
      actorsFromEnv ?? Object.freeze([...new Set(suggestedActors.map((a) => String(a)))])
    ),
    branchPrefixes: Object.freeze(prefixesFromEnv ?? DEFAULT_AGENTIC_BRANCH_PREFIXES),
  });
  return {
    policy,
    sources: Object.freeze({
      bot_actors: actorsFromEnv ? POLICY_SOURCE_OPERATOR_ENV : POLICY_SOURCE_ADAPTER_SUGGESTED,
      branch_prefixes: prefixesFromEnv ? POLICY_SOURCE_OPERATOR_ENV : POLICY_SOURCE_PRODUCT_DEFAULT,
    }),
  };
}

/** Report-model disclosure shape derived from a resolved policy + source. */
function classificationPolicyDisclosure(policy, sources) {
  return {
    bot_actors: [...policy.botActors].sort(),
    branch_prefixes: [...policy.branchPrefixes].sort(),
    bot_actors_source: sources.bot_actors,
    branch_prefixes_source: sources.branch_prefixes,
    note:
      "Pull requests are ingested only when matched by this policy: actor-allowlist matches count as measured-agentic, branch-prefix matches as inferred-agentic. Override via " +
      BOT_ACTORS_ENV +
      " / " +
      BRANCH_PREFIXES_ENV +
      ".",
  };
}

/**
 * Parse an "owner/repo" CLI argument.
 * @returns {{ owner: string, repo: string }}
 */
export function parseOwnerRepo(spec) {
  if (typeof spec !== "string") {
    throw new TypeError("--github expects OWNER/REPO");
  }
  const parts = spec.split("/");
  if (parts.length !== 2) {
    throw new TypeError(`--github expects OWNER/REPO (got "${spec}")`);
  }
  const [owner, repo] = parts;
  if (owner.length === 0 || repo.length === 0 || /\s/.test(owner) || /\s/.test(repo)) {
    throw new TypeError(`--github expects OWNER/REPO without whitespace (got "${spec}")`);
  }
  return { owner, repo };
}

/**
 * Run the complete read-only GitHub audit pipeline for one repository.
 *
 * @param {object} opts
 * @param {string} opts.owner            repository owner (org/user)
 * @param {string} opts.repo             repository name
 * @param {string} opts.token            GitHub credential (PAT or App installation token)
 * @param {Function} [opts.fetchImpl]    injected transport (tests only)
 * @param {object} [opts.limits]         bounded-sweep overrides forwarded to collectHistory
 * @param {object} [opts.policy]         operator classification policy; when omitted,
 *                                       resolved from BEETLEJUICE_BOT_ACTORS /
 *                                       BEETLEJUICE_BRANCH_PREFIXES with a documented
 *                                       conservative default (see resolveOperatorPolicy)
 * @returns {Promise<{ report: object, collection: object, mapping_stats: object, classification_policy: object }>}
 *   report model for renderers; `classification_policy` discloses exactly what
 *   was used to classify PRs as agentic and where each dimension came from.
 */
export async function runGithubReadOnly({ owner, repo, token, fetchImpl, limits, policy }) {
  if (typeof token !== "string" || token.length === 0) {
    const error = new Error(
      `real GitHub mode requires a credential in ${GITHUB_TOKEN_ENV} (read-only). ` +
        `Create one at https://github.com/settings/tokens with "Actions: read" + "Contents: read" + "Pull requests: read" and export it before running --github.`
    );
    error.code = "GITHUB_TOKEN_MISSING";
    throw error;
  }

  let github;
  let core;
  try {
    github = await import("@beetlejuice/github");
    core = await import("@beetlejuice/core");
  } catch (error) {
    const wrapped = new Error(
      `@beetlejuice/github and @beetlejuice/core must be mounted to run real GitHub mode (${error.message}). ` +
        `Run from the workspace root (npm workspaces) or add both packages to your runtime.`
    );
    wrapped.code = "SIBLING_PACKAGES_MISSING";
    throw wrapped;
  }

  // 0. Resolve the classification policy BEFORE any network I/O so operator
  //    configuration errors are exit-2 config errors, never mid-sweep failures.
  const explicitPolicy = policy ?? null;
  const resolved =
    explicitPolicy !== null
      ? { policy: explicitPolicy, sources: { bot_actors: POLICY_SOURCE_EXPLICIT, branch_prefixes: POLICY_SOURCE_EXPLICIT } }
      : resolveOperatorPolicy({ suggestedActors: github.SUGGESTED_AGENTIC_ACTORS });

  // 1. Read-only historical sweep of the configured repository (strictly GET).
  const evidence = await github.collectHistory({
    repoConfig: { owner, repo },
    token,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(limits ? { limits } : {}),
    policy: resolved.policy,
  });

  // 2. Map raw evidence into canonical AGENTIC_TASK events (adapter #1).
  const { events, stats } = github.assembleAudit(evidence);

  // 2b. Zero-matched honesty guard: an empty task set cannot produce an audit,
  //     and the underlying core-export rejection would be cryptic. Refuse with
  //     actionable guidance BEFORE the ledger — after proving (above) that the
  //     sweep itself succeeded. Beetlejuice never guesses which PRs are agentic.
  if (!Array.isArray(events) || events.length === 0) {
    const c = typeof stats?.counts === "object" && stats.counts !== null ? stats.counts : {};
    const seen = Number.isInteger(c.pulls_seen) ? c.pulls_seen : Array.isArray(evidence.prs) ? evidence.prs.length : 0;
    const matched =
      (Number(c.pulls_ingested_measured) || 0) + (Number(c.pulls_ingested_inferred) || 0);
    const error = new Error(
      `the classification policy matched ${matched} of ${seen} pull request(s), so there are no agentic tasks to audit in ${owner}/${repo}. ` +
        `Set ${BOT_ACTORS_ENV} (comma-separated bot logins, counted as measured-agentic) and/or ${BRANCH_PREFIXES_ENV} ` +
        `(comma-separated branch prefixes, counted as inferred-agentic; "-" disables prefix matching) ` +
        `to describe YOUR agent convention, then re-run. Beetlejuice never guesses which pull requests are agentic.`
    );
    error.code = "GITHUB_POLICY_MATCHED_NOTHING";
    throw error;
  }

  // 3. Tenant-local ledger: reconstruct tasks, attribute cost/outcome,
  //    run guarded certain-waste rules, refuse unbalanced accounting.
  const ledger = new core.TenantLedger(`github:${owner}/${repo}`);
  ledger.appendAll(events);
  const envelope = ledger.exportCoreAudit({
    producer:
      `@beetlejuice/github collector ${github.COLLECTOR_VERSION ?? "unknown"} / ` +
      `normalization ${github.NORMALIZATION_VERSION ?? "unknown"} (read-only history audit of ${owner}/${repo})`,
  });

  // 4. Render through the SAME core-audit consumer as every other tenant —
  //    economics are consumed verbatim from packages/core. The effective
  //    classification policy travels with the report: "which PRs counted as
  //    agentic, and why" must never be implicit.
  const report = buildReportFromCoreAudit(envelope, {
    mode: "real-github-read-only",
    classification_policy: classificationPolicyDisclosure(resolved.policy, resolved.sources),
  });
  return {
    report,
    collection: evidence.collection ?? null,
    mapping_stats: stats ?? null,
    classification_policy: report.classification_policy,
  };
}

/** Markdown mode label registered by the renderer for this surface. */
export const REAL_GITHUB_MODE = "real-github-read-only";
