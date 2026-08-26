// Integration e2e (audit finding A11; P0 criterion #7): ONE committed command
// turns `token + owner/repo` into an economics-first report — real read-only
// GitHub mode as committed behavior, not a README snippet.
//
// The full pipeline runs against an IN-MEMORY GitHub transport (same shape as
// api.github.com responses; zero network, zero credentials):
//
//   runGithubReadOnly({ owner, repo, token, fetchImpl })
//     -> collectHistory (strictly GET) -> assembleAudit
//     -> TenantLedger.appendAll -> exportCoreAudit
//     -> buildReportFromCoreAudit(mode: "real-github-read-only")
//
// Honesty contracts pinned here:
//   - missing token => typed refusal GITHUB_TOKEN_MISSING (never a fake audit);
//   - CLI --github without token => exit 2 with setup guidance;
//   - every request is a GET;
//   - the report is labeled `real-github-read-only`;
//   - upstream failure propagates honestly (exit 3 path exercised at CLI level
//     THROUGH the injected transport, asserting the specific adapter error code
//     and that requests were actually attempted — audit A12-MASK: an ambiguous
//     stderr regex must never be able to mask a pre-network wiring failure);
//   - operator classification-policy misconfiguration => exit 2 config errors
//     (GITHUB_POLICY_ENV_INVALID before any network I/O,
//     GITHUB_POLICY_MATCHED_NOTHING after a successful but empty sweep).

import { test } from "node:test";
import assert from "node:assert/strict";

const { runGithubReadOnly, parseOwnerRepo, GITHUB_TOKEN_ENV, BOT_ACTORS_ENV, BRANCH_PREFIXES_ENV } = await import(
  "../../apps/cli/src/github_mode.js"
);
const { runCli } = await import("../../apps/cli/src/demo.js");

const BEETLEJUICE_ACTORS_KEY = BOT_ACTORS_ENV;
const BEETLEJUICE_PREFIXES_KEY = BRANCH_PREFIXES_ENV;

/** Restore one process.env key exactly as found (undefined => delete). */
function restoreEnv(key, previous) {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

const OWNER = "demo-fixture";
const REPO = "agentic-pipeline";
const BOT = "relay-bot[bot]";
const PREFIX = "forge/";
const hex = (seed) => seed.repeat(40).slice(0, 40);
const REV1 = hex("a7");
const REV2 = hex("b3");

function inMemoryGithub({ runConclusion = "success", failAllAfter = null } = {}) {
  const methods = [];
  let calls = 0;
  const pull = {
    number: 501,
    state: "closed",
    title: "synthetic real-mode change",
    created_at: "2026-07-01T09:00:00Z",
    closed_at: "2026-07-02T12:30:00Z",
    merged_at: "2026-07-02T12:30:00Z",
    user: { login: BOT },
    head: { ref: `${PREFIX}real-mode`, sha: REV2 },
    base: { ref: "main" },
  };
  const commits = [
    { sha: REV1, commit: { committer: { date: "2026-07-01T09:05:00Z" }, author: { date: "2026-07-01T09:05:00Z" }, message: "rev 1" }, parents: [] },
    { sha: REV2, commit: { committer: { date: "2026-07-01T15:00:00Z" }, author: { date: "2026-07-01T15:00:00Z" }, message: "rev 2" }, parents: [] },
  ];
  const runJson = (attempt, startedAt, updatedAt) => ({
    id: 5100,
    run_attempt: attempt,
    status: "completed",
    conclusion: runConclusion,
    head_branch: `${PREFIX}real-mode`,
    head_sha: REV2,
    run_started_at: startedAt,
    updated_at: updatedAt,
    path: ".github/workflows/ci.yml@refs/heads/main",
    name: "ci",
    pull_requests: [{ number: 501 }],
  });
  const fetchImpl = async (url, init) => {
    calls += 1;
    if (failAllAfter !== null && calls > failAllAfter) return { status: 500, headers: {}, json: null };
    methods.push(init?.method ?? "GET");
    const p = new URL(url).pathname;
    if (p.endsWith(`/repos/${OWNER}/${REPO}/pulls`)) return { status: 200, headers: {}, json: [pull] };
    if (/\/pulls\/(\d+)\/commits$/.test(p)) return { status: 200, headers: {}, json: commits };
    if (p.endsWith("/actions/runs")) {
      return {
        status: 200,
        headers: {},
        json: { workflow_runs: [runJson(1, "2026-07-01T15:10:00Z", "2026-07-01T15:20:00Z")] },
      };
    }
    // Integration repair (cycle 32957437769): the github lane's workflow-jobs
    // collector probes /actions/runs/{id}/jobs; serve an empty job list so
    // real-mode sweeps stay read-only without fabricating evidence.
    if (/\/actions\/runs\/(\d+)\/jobs$/.test(p)) return { status: 200, headers: {}, json: { total_count: 0, jobs: [] } };
    if (/\/commits\/([0-9a-f]+)\/check-runs$/.test(p)) return { status: 200, headers: {}, json: { check_runs: [] } };
    return { status: 404, headers: {}, json: null };
  };
  return { fetchImpl, methods, callCount: () => calls };
}

test("parseOwnerRepo enforces the OWNER/REPO shape", () => {
  assert.deepEqual(parseOwnerRepo("acme/widget"), { owner: "acme", repo: "widget" });
  assert.throws(() => parseOwnerRepo("just-a-name"), TypeError);
  assert.throws(() => parseOwnerRepo("a/b/c"), TypeError);
  assert.throws(() => parseOwnerRepo("has space/x"), TypeError);
});

test("missing token refuses honestly instead of fabricating an audit", async () => {
  await assert.rejects(
    () => runGithubReadOnly({ owner: OWNER, repo: REPO, token: "" }),
    (error) => error.code === "GITHUB_TOKEN_MISSING"
  );
});

test(
  "token + repo -> full economics-first report labeled real-github-read-only (GET-only)",
  async () => {
    const gh = inMemoryGithub();
    const { report, collection } = await runGithubReadOnly({
      owner: OWNER,
      repo: REPO,
      token: "simulated-token-not-a-secret",
      fetchImpl: gh.fetchImpl,
      policy: { botActors: [BOT], branchPrefixes: [PREFIX] },
    });

    // Read-only sweep.
    assert.ok(gh.methods.length > 0);
    assert.ok(gh.methods.every((m) => m === "GET"), "real mode must issue GET requests only");
    assert.ok(collection.requests.length > 0);

    // Economics-first report model, explicitly labeled as REAL repository mode.
    assert.equal(report.mode, "real-github-read-only");
    assert.equal(report.headline.successful_outcomes, 1, "the merged PR attributes to one accepted outcome");
    // Without operator-supplied Actions usage records, real mode degrades
    // HONESTLY: cost components are counted as unavailable ($0 is never
    // invented) while outcomes/attribution still work end-to-end.
    assert.equal(report.headline.total_measured_cost_micro_usd, 0);
    assert.equal(
      report.headline.cost_components_unavailable > 0,
      true,
      "CI spend without a supplied usage record must surface as unavailable, not guessed"
    );
    assert.equal(report.data_quality.accounting_balanced, true);

    // The credential never appears anywhere in the rendered output.
    const { renderMarkdownReport } = await import("../../apps/cli/src/report/markdown.js");
    const markdown = renderMarkdownReport(report);
    assert.match(markdown, /# Beetlejuice Audit — Agentic Economics Report/);
    assert.match(markdown, /real-github-read-only mode/);
    assert.doesNotMatch(markdown, /simulated-token/);
    const headline = markdown.split("## Certain-waste findings")[0];
    assert.match(headline, /Cost per successful outcome/);
    assert.doesNotMatch(headline, /token/i);
  }
);

async function captureStdoutAndErr(fn) {
  const out = [];
  const err = [];
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  process.stdout.write = (c) => { out.push(String(c)); return true; };
  process.stderr.write = (c) => { err.push(String(c)); return true; };
  try {
    const code = await fn();
    return { code, stdout: out.join(""), stderr: err.join("") };
  } finally {
    process.stdout.write = o;
    process.stderr.write = e;
  }
}

test("CLI --github without BEETLEJUICE_GITHUB_TOKEN exits 2 with setup guidance", async () => {
  const previous = process.env[GITHUB_TOKEN_ENV];
  delete process.env[GITHUB_TOKEN_ENV];
  try {
    const { code, stderr } = await captureStdoutAndErr(() => runCli(["--github", `${OWNER}/${REPO}`]));
    assert.equal(code, 2);
    assert.match(stderr, new RegExp(GITHUB_TOKEN_ENV));
    assert.match(stderr, /read-only/i);
  } finally {
    if (previous !== undefined) process.env[GITHUB_TOKEN_ENV] = previous;
  }
});

// A12-MASK repair: the upstream-failure case must prove the transport was
// actually reached (requests attempted > 0) and assert the SPECIFIC adapter
// error code, so a pre-network wiring failure (e.g. a missing-policy TypeError)
// can never satisfy this test again. The failing transport is injected through
// the real CLI entrypoint (runCli deps), not constructed and discarded.
test("CLI --github propagates upstream failure honestly (exit 3, transport actually exercised)", async () => {
  const previous = process.env[GITHUB_TOKEN_ENV];
  process.env[GITHUB_TOKEN_ENV] = "simulated-token-not-a-secret";
  const previousActors = process.env.BEETLEJUICE_BOT_ACTORS;
  const previousPrefixes = process.env.BEETLEJUICE_BRANCH_PREFIXES;
  process.env.BEETLEJUICE_BOT_ACTORS = BOT;
  process.env.BEETLEJUICE_BRANCH_PREFIXES = PREFIX;
  const failing = inMemoryGithub({ failAllAfter: 0 }); // transport returns 500 for everything
  try {
    const { code, stderr } = await captureStdoutAndErr(() =>
      runCli(["--github", `${OWNER}/${REPO}`, "--out", ""], { fetchImpl: failing.fetchImpl })
    );
    assert.equal(code, 3, "upstream failure must exit non-zero rather than fake success");
    // Specific adapter taxonomy code — not an ambiguous catch-all regex.
    assert.match(stderr, /UPSTREAM_ERROR|NETWORK_ERROR_REDACTED/);
    // The wiring must never masquerade as an upstream failure.
    assert.doesNotMatch(stderr, /policy/i);
    // Proof the pipeline genuinely issued network work before failing.
    assert.ok(failing.callCount() > 0, "the injected transport was never exercised");
  } finally {
    if (previous !== undefined) process.env[GITHUB_TOKEN_ENV] = previous;
    else delete process.env[GITHUB_TOKEN_ENV];
    restoreEnv(BEETLEJUICE_ACTORS_KEY, previousActors);
    restoreEnv(BEETLEJUICE_PREFIXES_KEY, previousPrefixes);
  }
});

// A12 (P0 #7): the COMMITTED command path — `runCli(["--github", ...])` with no
// explicit policy object — must succeed end-to-end by resolving the operator
// classification policy from the environment (BEETLEJUICE_BOT_ACTORS /
// BEETLEJUICE_BRANCH_PREFIXES). This is the exact invocation that died
// pre-network with `an explicit policy is required` before the A12 repair.
test("CLI --github resolves the operator policy from env vars and succeeds through runCli", async () => {
  const previous = process.env[GITHUB_TOKEN_ENV];
  const previousActors = process.env[BEETLEJUICE_ACTORS_KEY];
  const previousPrefixes = process.env[BEETLEJUICE_PREFIXES_KEY];
  process.env[GITHUB_TOKEN_ENV] = "simulated-token-not-a-secret";
  process.env[BEETLEJUICE_ACTORS_KEY] = BOT; // measured-agentic actor
  process.env[BEETLEJUICE_PREFIXES_KEY] = PREFIX; // inferred-agentic prefix
  const gh = inMemoryGithub();
  try {
    const { code, stdout } = await captureStdoutAndErr(() =>
      runCli(["--github", `${OWNER}/${REPO}`, "--format", "json"], { fetchImpl: gh.fetchImpl })
    );
    assert.equal(code, 0, "the committed --github command must produce an audit");
    assert.ok(gh.methods.length > 0);
    assert.ok(gh.methods.every((m) => m === "GET"), "CLI-driven real mode stays GET-only");

    const report = JSON.parse(stdout);
    assert.equal(report.mode, "real-github-read-only");
    assert.equal(report.headline.successful_outcomes, 1);
    // The effective policy is disclosed in the report: which PRs counted as
    // agentic, under which confidence dimension, from which source.
    assert.ok(report.classification_policy, "real-mode reports disclose the classification policy");
    assert.deepEqual(report.classification_policy.bot_actors, [BOT]);
    assert.deepEqual(report.classification_policy.branch_prefixes, [PREFIX]);
    assert.equal(report.classification_policy.bot_actors_source, "operator-env");
    assert.equal(report.classification_policy.branch_prefixes_source, "operator-env");
  } finally {
    if (previous !== undefined) process.env[GITHUB_TOKEN_ENV] = previous;
    else delete process.env[GITHUB_TOKEN_ENV];
    restoreEnv(BEETLEJUICE_ACTORS_KEY, previousActors);
    restoreEnv(BEETLEJUICE_PREFIXES_KEY, previousPrefixes);
  }
});

test("malformed policy env var is an exit-2 config error BEFORE any network I/O", async () => {
  const previous = process.env[GITHUB_TOKEN_ENV];
  const previousActors = process.env[BEETLEJUICE_ACTORS_KEY];
  process.env[GITHUB_TOKEN_ENV] = "simulated-token-not-a-secret";
  process.env[BEETLEJUICE_ACTORS_KEY] = "two words"; // whitespace inside one entry => fail fast
  const gh = inMemoryGithub();
  try {
    const { code, stderr } = await captureStdoutAndErr(() =>
      runCli(["--github", `${OWNER}/${REPO}`], { fetchImpl: gh.fetchImpl })
    );
    assert.equal(code, 2, "operator misconfiguration is a setup problem, not an upstream failure");
    assert.match(stderr, /GITHUB_POLICY_ENV_INVALID/);
    assert.match(stderr, new RegExp(BEETLEJUICE_ACTORS_KEY));
    assert.equal(gh.callCount(), 0, "config validation must happen before any request");
  } finally {
    if (previous !== undefined) process.env[GITHUB_TOKEN_ENV] = previous;
    else delete process.env[GITHUB_TOKEN_ENV];
    restoreEnv(BEETLEJUICE_ACTORS_KEY, previousActors);
  }
});

test("a policy that matches zero PRs refuses with guidance after a successful sweep", async () => {
  const previous = process.env[GITHUB_TOKEN_ENV];
  const previousActors = process.env[BEETLEJUICE_ACTORS_KEY];
  const previousPrefixes = process.env[BEETLEJUICE_PREFIXES_KEY];
  process.env[GITHUB_TOKEN_ENV] = "simulated-token-not-a-secret";
  // Explicitly emptied dimensions: nothing can match, so the audit must refuse
  // instead of rendering an empty report as if it were evidence.
  process.env[BEETLEJUICE_ACTORS_KEY] = "-";
  process.env[BEETLEJUICE_PREFIXES_KEY] = "-";
  const gh = inMemoryGithub();
  try {
    const { code, stderr } = await captureStdoutAndErr(() =>
      runCli(["--github", `${OWNER}/${REPO}`], { fetchImpl: gh.fetchImpl })
    );
    assert.equal(code, 2);
    assert.match(stderr, /GITHUB_POLICY_MATCHED_NOTHING/);
    assert.match(stderr, /matched 0 of 1 pull request/i);
    assert.ok(gh.callCount() > 0, "the refusal comes AFTER proving the sweep succeeded");
  } finally {
    if (previous !== undefined) process.env[GITHUB_TOKEN_ENV] = previous;
    else delete process.env[GITHUB_TOKEN_ENV];
    restoreEnv(BEETLEJUICE_ACTORS_KEY, previousActors);
    restoreEnv(BEETLEJUICE_PREFIXES_KEY, previousPrefixes);
  }
});
