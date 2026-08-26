/**
 * Deterministic, tenant-scope reference builders (WC-002 acceptance:
 * "raw GitHub identifiers remain in tenant/source scope and never leak into
 * the global exporter interface").
 *
 * Every raw GitHub coordinate (owner/name, PR number, run id, SHA) lives only
 * inside refs that are scoped by the collected repository (`scopeKey`). Refs
 * are stable within one collection so re-ingestion is reproducible and the
 * tenant ledger's duplicate guards hold. They are NOT global identifiers:
 * two different repositories produce differently-scoped refs for the same PR
 * number, and nothing in this package derives a cross-tenant stable id from
 * them (no global hashing of repo/user/commit exists anywhere here).
 */
import { invalidConfig } from './errors.js';

export const ADAPTER_ID = 'github';

/** Validate + normalize the repository scope every collection is bound to. */
export function repoScope(config) {
  const owner = normalizedSlug(config?.owner, 'owner');
  const repo = normalizedSlug(config?.repo, 'repo');
  return Object.freeze({ owner, repo, key: `${owner}/${repo}` });
}

function normalizedSlug(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw invalidConfig(`config.${field} must be a non-empty GitHub slug`, { field });
  }
  return value;
}

// --- Tenant-scoped domain refs (deterministic per scope) --------------------

export const taskRefForPr = (n) => `t:pr:${n}`;
export const prRefFor = (n) => `pr:${n}`;
export const executionRefForRevision = (taskRef, sha) => `${taskRef}:rev:${sha}`;
export const ciRefFor = (runId, attempt) => `ci:wfrun:${runId}@a${attempt}`;
export const validationRefForCheckRun = (checkRunId) => `val:checkrun:${checkRunId}`;
/** Actions job ids are globally unique across attempts, so the ref needs no attempt part. */
export const computeRefForWorkflowJob = (jobId) => `cmp:wfjob:${jobId}`;

/**
 * Event ids embed the repo scope so one tenant ledger can ingest several
 * repositories without id collisions — while staying tenant-local.
 */
export const eventId = (scopeKey, kind, ...parts) => `ev:${scopeKey}:${kind}:${parts.join(':')}`;

/**
 * Raw upstream coordinates for `source.ref` — provenance metadata in the
 * tenant/source layer ONLY. Never used as identity by the canonical model.
 */
export const apiRef = {
  pull: (scopeKey, n) => `${scopeKey}/pulls/${n}`,
  commits: (scopeKey, n) => `${scopeKey}/pulls/${n}/commits`,
  workflowRunAttempt: (scopeKey, runId, attempt) =>
    `${scopeKey}/actions/runs/${runId}/attempts/${attempt}`,
  workflowRunJobs: (scopeKey, runId) => `${scopeKey}/actions/runs/${runId}/jobs`,
  checkRuns: (scopeKey, sha) => `${scopeKey}/commits/${sha}/check-runs`,
};
