/**
 * Read-only historical bootstrap collection (WC-002 "historical bootstrap
 * audit"). Orchestrates a bounded, fully-GET evidence sweep of one repository:
 *
 *   1. list pull requests (state=all);
 *   2. classify each PR with the operator policy (measured/inferred/excluded);
 *   3. for ingested PRs, fetch the PR commit list (revision evidence);
 *   4. list Actions workflow runs;
 *   5. fetch check-runs per distinct revision SHA of ingested PRs.
 *
 * The result is an inert `RawEvidence` structure — plain JSON-shaped data —
 * that `assembleAudit()` maps into canonical events. Collection and mapping
 * are strictly separated so fixture tests can feed stored payloads without
 * any transport, and real mode is only ever exercised at this seam.
 */
import { createGithubRestClient, paginate } from './client.js';
import { repoScope } from '../refs.js';
import { normalizePolicy, classifyPullRequest } from '../policy.js';
import { invalidConfig } from '../errors.js';

export const DEFAULT_LIMITS = Object.freeze({
  maxPrPages: 5,
  maxRunPages: 10,
  maxCommitPagesPerPr: 2,
  maxCheckShaCount: 40,
});

/**
 * Collect raw evidence for one repository.
 * @param {object} opts
 * @param {{owner:string, repo:string}} opts.repoConfig
 * @param {object} opts.policy            { botActors?, branchPrefixes? }
 * @param {object} [opts.client]          pre-built client (tests inject stubs)
 * @param {string}  [opts.token]          credential when using the default client
 * @param {Function} [opts.fetchImpl]    injected transport
 * @param {object}  [opts.limits]         bounded-sweep overrides
 */
export async function collectHistory({ repoConfig, policy, client, token, fetchImpl, limits = {} }) {
  const scope = repoScope(repoConfig);
  const pol = normalizePolicy(policy);
  const lim = validateLimits(limits);

  if (!client && !fetchImpl && token === undefined) {
    throw invalidConfig(
      'collectHistory requires either an explicit client, a fetchImpl, or a token for real read-only mode',
      {}
    );
  }
  const rest = client ?? createGithubRestClient({ token, fetchImpl });

  const requests = [];
  const track = async (label, path, params) => {
    requests.push(label);
    return rest.request(path, params);
  };

  // 1. Pull requests ---------------------------------------------------------
  const prs = [];
  for await (const page of paginate(
    (path, params) => track('list_pulls', path, params),
    `/repos/${scope.owner}/${scope.repo}/pulls`,
    { query: { state: 'all', sort: 'created', direction: 'asc' }, maxPages: lim.maxPrPages }
  )) {
    if (Array.isArray(page.json)) prs.push(...page.json);
  }

  // 2. Classify ---------------------------------------------------------------
  const prClassifications = new Map(); // pr number -> classification
  const agenticPrs = [];
  let excludedNonAgentic = 0;
  for (const pr of prs) {
    const cls = classifyPullRequest(pr, pol);
    prClassifications.set(pr.number, cls);
    if (cls.agentic) agenticPrs.push(pr);
    else excludedNonAgentic += 1;
  }

  // 3. Commits per ingested PR -------------------------------------------------
  const commitsByPull = new Map();
  for (const pr of agenticPrs) {
    const commits = [];
    for await (const page of paginate(
      (path, params) => track(`list_pr_commits:${pr.number}`, path, params),
      `/repos/${scope.owner}/${scope.repo}/pulls/${pr.number}/commits`,
      { maxPages: lim.maxCommitPagesPerPr }
    )) {
      if (Array.isArray(page.json)) commits.push(...page.json);
    }
    commitsByPull.set(pr.number, commits);
  }

  // 4. Workflow runs -----------------------------------------------------------
  const workflowRuns = [];
  for await (const page of paginate(
    (path, params) => track('list_workflow_runs', path, params),
    `/repos/${scope.owner}/${scope.repo}/actions/runs`,
    { query: {}, maxPages: lim.maxRunPages }
  )) {
    const runs = page.json?.workflow_runs;
    if (Array.isArray(runs)) workflowRuns.push(...runs);
  }

  // 5. Check runs per known revision SHA ---------------------------------------
  // Data minimization: we probe ONLY revisions of INGESTED agentic PRs.
  // Check-run evidence for foreign branches cannot be attached to a canonical
  // task, so fetching it would collect out-of-scope data for no product use.
  const shas = distinctRevisionShas(commitsByPull).slice(0, lim.maxCheckShaCount);
  const checkRunsBySha = new Map();
  for (const sha of shas) {
    const res = await track(`check_runs:${sha}`, `/repos/${scope.owner}/${scope.repo}/commits/${sha}/check-runs`, {});
    const runs = res.json?.check_runs;
    checkRunsBySha.set(sha, Array.isArray(runs) ? runs : []);
  }

  return Object.freeze({
    scope,
    policy: pol,
    prs,
    prClassifications,
    commitsByPull,
    workflowRuns,
    checkRunsBySha,
    collection: Object.freeze({
      requests: Object.freeze(requests.slice()),
      limits: lim,
      truncated: Object.freeze({
        pullRequests: prs.length > 0 && requests.filter((r) => r === 'list_pulls').length >= lim.maxPrPages,
        workflowRuns: workflowRuns.length > 0 && requests.filter((r) => r === 'list_workflow_runs').length >= lim.maxRunPages,
        checkShas: distinctRevisionShas(commitsByPull).length > shas.length,
      }),
    }),
  });
}

/** Distinct revision SHAs of ingested PRs, stable order (PR asc, commit order). */
function distinctRevisionShas(commitsByPull) {
  const ordered = [];
  const seen = new Set();
  const push = (sha) => {
    if (typeof sha !== 'string' || sha.length < 7 || seen.has(sha)) return;
    seen.add(sha);
    ordered.push(sha);
  };
  const sortedPulls = [...commitsByPull.keys()].sort((a, b) => a - b);
  for (const n of sortedPulls) for (const c of commitsByPull.get(n)) push(c?.sha);
  return ordered;
}

function validateLimits(limits) {
  const merged = { ...DEFAULT_LIMITS, ...(limits ?? {}) };
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    const v = merged[key];
    if (!Number.isInteger(v) || v < 1 || v > 1000) {
      throw invalidConfig(`limits.${key} must be an integer in [1, 1000]`, { key });
    }
  }
  return Object.freeze(merged);
}
