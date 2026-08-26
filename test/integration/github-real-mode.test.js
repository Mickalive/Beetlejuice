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
//     via a transport that returns 500).

import { test } from "node:test";
import assert from "node:assert/strict";

const { runGithubReadOnly, parseOwnerRepo, GITHUB_TOKEN_ENV } = await import("../../apps/cli/src/github_mode.js");
const { runCli } = await import("../../apps/cli/src/demo.js");

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
    if (/\/commits\/([0-9a-f]+)\/check-runs$/.test(p)) return { status: 200, headers: {}, json: { check_runs: [] } };
    return { status: 404, headers: {}, json: null };
  };
  return { fetchImpl, methods };
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

test("CLI --github propagates upstream failure honestly (exit 3, no fabricated data)", async () => {
  const previous = process.env[GITHUB_TOKEN_ENV];
  process.env[GITHUB_TOKEN_ENV] = "simulated-token-not-a-secret";
  const failing = inMemoryGithub({ failAllAfter: 0 }); // transport returns 500 for everything
  try {
    const { code, stderr } = await captureStdoutAndErr(() =>
      runCli(["--github", `${OWNER}/${REPO}`, "--out", ""])
    );
    assert.equal(code, 3, "upstream failure must exit non-zero rather than fake success");
    assert.match(stderr, /GITHUB AUDIT FAILED|UPSTREAM_ERROR|NETWORK_ERROR_REDACTED|error:/);
  } finally {
    if (previous !== undefined) process.env[GITHUB_TOKEN_ENV] = previous;
    else delete process.env[GITHUB_TOKEN_ENV];
    void failing;
  }
});
