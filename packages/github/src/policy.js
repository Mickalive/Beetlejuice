/**
 * Agentic-classification + correlation policy (WC-002 correlation strategy).
 *
 * Beetlejuice measures AGENTIC engineering cost. Read-only GitHub evidence
 * never "proves" agency by itself, so classification is explicit about its
 * confidence:
 *   - 'measured'  — the PR creator login is on the configured bot allowlist.
 *   - 'inferred'  — only a configured branch-prefix convention matched.
 *   - not agentic — excluded from ingestion entirely, counted honestly.
 *
 * There are NO silent defaults: an empty policy ingests nothing rather than
 * guessing which PRs are agentic.
 */

export const CONFIDENCE_MEASURED = 'measured';
export const CONFIDENCE_INFERRED = 'inferred';

/**
 * Well-known coding-agent actor logins, offered as documentation/config help.
 * Nothing here is applied automatically — operators opt in explicitly.
 */
export const SUGGESTED_AGENTIC_ACTORS = Object.freeze([
  'beetlejuice[bot]',
  'copilot-swe-agent[bot]',
  'devin-ai-integration[bot]',
  'cursor[bot]',
  'codex[bot]',
  'google-labs-jules[bot]',
]);

export function normalizePolicy(policy) {
  if (policy === undefined || policy === null) {
    throw new TypeError(
      'an explicit policy is required: provide botActors and/or branchPrefixes (empty policy ingests nothing)'
    );
  }
  if (typeof policy !== 'object') {
    throw new TypeError('policy must be an object');
  }
  const actorLogins = new Set(toArrayOfSlugs(policy.botActors, 'policy.botActors').map((s) => s.toLowerCase()));
  const branchPrefixes = toArrayOfSlugs(policy.branchPrefixes, 'policy.branchPrefixes');
  return Object.freeze({ actorLogins, branchPrefixes });
}

function toArrayOfSlugs(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array of non-empty strings`);
  for (const v of value) {
    if (typeof v !== 'string' || v.length === 0) {
      throw new TypeError(`${field} entries must be non-empty strings`);
    }
  }
  return [...value];
}

/**
 * Decide whether a PR belongs to an agentic task and with what confidence.
 * Returns { agentic:true, confidence, basis } or { agentic:false }.
 */
export function classifyPullRequest(pr, policy) {
  const login = String(pr?.user?.login ?? '').toLowerCase();
  if (login && policy.actorLogins.has(login)) {
    return { agentic: true, confidence: CONFIDENCE_MEASURED, basis: 'bot_actor_allowlist' };
  }
  const headRef = String(pr?.head?.ref ?? '');
  const prefix = policy.branchPrefixes.find((p) => headRef.startsWith(p));
  if (prefix !== undefined && prefix.length > 0) {
    return { agentic: true, confidence: CONFIDENCE_INFERRED, basis: `branch_prefix_match:${prefix}` };
  }
  return { agentic: false, confidence: null, basis: 'not_matched_by_policy' };
}

/** A branch counts as agent-shaped under the policy (used for CI fallback). */
export function classifyBranch(branchRef, policy) {
  const prefix = policy.branchPrefixes.find((p) => String(branchRef).startsWith(p));
  return prefix !== undefined && prefix.length > 0
    ? { agentic: true, confidence: CONFIDENCE_INFERRED, basis: `branch_prefix_match:${prefix}` }
    : { agentic: false, confidence: null, basis: 'not_matched_by_policy' };
}

// --- Correlation confidence vocabulary --------------------------------------

/**
 * Correlation confidence for attaching CI/check evidence to a PR task:
 *   'explicit' — GitHub itself linked the run to the PR
 *                (workflow_run.pull_requests non-empty).
 *   'inferred' — we matched head_branch/head SHA equality (fork PRs lose the
 *                link array; this is the documented GitHub behavior).
 */
export const LINK_EXPLICIT = 'explicit';
export const LINK_INFERRED = 'inferred';
