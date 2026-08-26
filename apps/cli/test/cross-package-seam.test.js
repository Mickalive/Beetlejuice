// Cross-package seam e2e (audit finding A9): the seams between lanes were
// only ever exercised by out-of-band probes, so seam drift (defects A2, A7)
// stayed invisible to CI. This committed test executes the REAL product
// journey across package boundaries when siblings are mounted:
//
//   in-memory GitHub (GET-only) -> @beetlejuice/github collectHistory()
//   -> assembleAudit() -> @beetlejuice/core TenantLedger.appendAll()
//   -> TenantLedger.exportCoreAudit() -> THIS surface's validateCoreAuditExport()
//   -> buildReportFromCoreAudit() -> rendered markdown report.
//
// Lane hermeticity: on a product-lane-only checkout the sibling packages are
// absent; the e2e then SKIPS with an explicit reason (never silently), while
// the presence probe below still executes so the file always contributes an
// assertion. On integration trees the e2e runs for real and fails CI on any
// cross-package drift.

import { test } from "node:test";
import assert from "node:assert/strict";

let core = null;
let github = null;
let loadError = null;
try {
  core = await import("@beetlejuice/core");
  github = await import("@beetlejuice/github");
} catch (error) {
  loadError = error;
}
const siblingsMounted = core !== null && github !== null;

const SKIP_REASON =
  "sibling packages @beetlejuice/core and/or @beetlejuice/github are not mounted on this lane checkout; the cross-package e2e executes on integrated trees";

test("cross-package availability is explicit, never silent", () => {
  if (siblingsMounted) {
    assert.ok(core.TenantLedger, "@beetlejuice/core must export TenantLedger");
    assert.ok(github.collectHistory, "@beetlejuice/github must export collectHistory");
    assert.ok(github.assembleAudit, "@beetlejuice/github must export assembleAudit");
  } else {
    assert.equal(loadError?.code ?? "ERR_MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND");
    console.log(`[skip] ${SKIP_REASON}`);
  }
});

test(
  "credential-free github -> core -> product audit renders an economics-first report",
  { skip: siblingsMounted ? false : SKIP_REASON },
  async () => {
    const { TenantLedger } = core;
    const {
      createGithubRestClient,
      collectHistory,
      assembleAudit,
      actionsUsageCostSource,
    } = github;

    // --- Minimal deterministic in-memory GitHub (fictional values only) -----
    // One MERGED agentic PR with two revisions; one workflow run whose second
    // attempt re-ran identical inputs after attempt 1 passed (the canonical
    // duplicated-CI evidence shape). No credentials anywhere.
    const owner = "demo-fixture";
    const repo = "agentic-pipeline";
    const botActor = "relay-bot[bot]";
    const branchPrefix = "forge/";
    const hex = (seed) => seed.repeat(40).slice(0, 40);
    const rev1 = hex("a7");
    const rev2 = hex("b3");

    const pull = {
      number: 501,
      state: "closed",
      title: "synthetic seam change",
      created_at: "2026-07-01T09:00:00Z",
      closed_at: "2026-07-02T12:30:00Z",
      merged_at: "2026-07-02T12:30:00Z",
      user: { login: botActor },
      head: { ref: `${branchPrefix}seam-probe`, sha: rev2 },
      base: { ref: "main" },
    };
    const commits = [
      {
        sha: rev1,
        commit: {
          committer: { date: "2026-07-01T09:05:00Z" },
          author: { date: "2026-07-01T09:05:00Z" },
          message: "synthetic revision 1",
        },
        parents: [],
      },
      {
        sha: rev2,
        commit: {
          committer: { date: "2026-07-01T15:00:00Z" },
          author: { date: "2026-07-01T15:00:00Z" },
          message: "synthetic revision 2",
        },
        parents: [],
      },
    ];
    const runJson = (attempt, startedAt, updatedAt) => ({
      id: 5100,
      run_attempt: attempt,
      status: "completed",
      conclusion: "success",
      head_branch: `${branchPrefix}seam-probe`,
      head_sha: rev2,
      run_started_at: startedAt,
      updated_at: updatedAt,
      path: ".github/workflows/ci.yml@refs/heads/main",
      name: "ci",
      pull_requests: [{ number: 501 }],
    });
    const runs = [
      runJson(1, "2026-07-01T15:10:00Z", "2026-07-01T15:20:00Z"),
      runJson(2, "2026-07-01T16:00:00Z", "2026-07-01T16:05:00Z"),
    ];

    const methods = [];
    const fetchImpl = async (url, init) => {
      methods.push(init?.method ?? "GET");
      const u = new URL(url);
      const p = u.pathname;
      if (p.endsWith(`/repos/${owner}/${repo}/pulls`)) return { status: 200, headers: {}, json: [pull] };
      if (/\/pulls\/(\d+)\/commits$/.test(p)) return { status: 200, headers: {}, json: commits };
      if (p.endsWith("/actions/runs")) return { status: 200, headers: {}, json: { workflow_runs: runs } };
      if (/\/commits\/([0-9a-f]+)\/check-runs$/.test(p)) return { status: 200, headers: {}, json: { check_runs: [] } };
      return { status: 404, headers: {}, json: null };
    };

    // --- Read-only sweep over the injected transport ------------------------
    const client = createGithubRestClient({ fetchImpl });
    const evidence = await collectHistory({
      repoConfig: { owner, repo },
      policy: { botActors: [botActor], branchPrefixes: [branchPrefix] },
      client,
    });

    const rateUsdPerMinute = 0.008; // $0.48/hour of Actions compute
    const usageByAttempt = new Map([
      ["5100@a1", { billable_ms: 600_000 }], // 10 min -> $0.08
      ["5100@a2", { billable_ms: 300_000 }], // 5 min  -> $0.04
    ]);
    const { events, stats } = assembleAudit(evidence, {
      costSource: actionsUsageCostSource({ usageByAttempt, rateUsdPerMinute }),
    });

    assert.ok(methods.length > 0);
    assert.ok(methods.every((m) => m === "GET"), "the whole sweep must be read-only GETs");
    assert.ok(events.length > 0);

    // --- Adapter -> tenant analytics (core ledger) --------------------------
    const ledger = new TenantLedger("tenant-local-scope");
    const acceptedCount = ledger.appendAll(events);
    assert.equal(acceptedCount, events.length, "every normalized event must be admitted");

    const audit = ledger.audit();
    assert.equal(audit.summary.cost.accountingBalanced, true, "ledger accounting must be balanced");
    // Both engines must agree on measured spend — no money invented or lost at the seam.
    assert.equal(stats.costs.known_micro_usd_total, 120_000); // $0.12
    assert.equal(audit.summary.cost.knownMicroUsd, 120_000);
    assert.equal(audit.summary.totals.accepted, 1, "the merged PR attributes as accepted");
    assert.equal(audit.summary.cost.costPerAcceptedOutcomeMicroUsd, 120_000);

    // --- Core export -> product surface ------------------------------------
    const envelope = ledger.exportCoreAudit({ producer: "cross-package-seam-e2e" });
    const { validateCoreAuditExport, buildReportFromCoreAudit } = await import("../src/index.js");
    const validation = validateCoreAuditExport(envelope);
    assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));

    const report = buildReportFromCoreAudit(envelope, { mode: "canonical-core" });
    assert.equal(report.mode, "canonical-core");
    assert.equal(report.headline.total_measured_cost_micro_usd, 120_000);
    assert.equal(report.headline.successful_outcomes, 1);
    assert.equal(report.headline.cost_per_successful_outcome_micro_usd, 120_000);
    assert.equal(report.headline.certainly_avoidable_spend_micro_usd, audit.waste.certainlyAvoidableMicroUsd);
    assert.equal(report.data_quality.accounting_balanced, true);

    // Savings traceability holds across the seam: every savings dollar maps to
    // an exported, core-certified certain-waste finding.
    assert.ok(report.findings.length >= 1, "the duplicated-CI evidence must produce a finding");
    for (const finding of report.findings) {
      assert.equal(finding.confidence, "certain");
      assert.ok(finding.evidence_units.length > 0 || finding.unquantified_evidence_refs.length > 0);
    }
    const findingsSum = report.findings.reduce((acc, f) => acc + f.wasted_micro_usd, 0);
    assert.equal(findingsSum, report.headline.certainly_avoidable_spend_micro_usd);
    assert.ok(
      report.findings.some((f) => f.rule_id === "WASTE_DUP_CI_V1"),
      "identical post-pass CI re-run must be detected end-to-end"
    );

    const { renderMarkdownReport } = await import("../src/report/markdown.js");
    const markdown = renderMarkdownReport(report);
    assert.match(markdown, /# Beetlejuice Audit — Agentic Economics Report/);
    assert.match(markdown, /\$0\.12/);
    assert.match(markdown, /Cost per successful outcome/);
    assert.doesNotMatch(markdown.split("## Secondary diagnostics")[0], /token/i);
  }
);
