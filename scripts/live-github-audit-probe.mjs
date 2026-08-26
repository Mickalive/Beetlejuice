// Live-network verification probe (integration director, cycle 32936499446).
//
// Proves the complete read-only GitHub pipeline against the REAL api.github.com
// using a public repository (unauthenticated reads, strictly GET):
//
//   collectHistory (live GETs) -> assembleAudit -> TenantLedger.appendAll
//     -> exportCoreAudit -> buildReportFromCoreAudit -> markdown
//
// Executed successfully 2026-08-26 against eubby06/kids-store (a young public
// repository with copilot-swe-agent[bot] activity): 18 live GET requests,
// 6 PRs -> 45 canonical events, 4 accepted / 2 unresolved, 5 certain-waste
// findings (superseded-execution class), cost components honestly unavailable,
// report labeled real-github-read-only.
//
// NOT part of npm test: this hits the network and depends on a living external
// repository. Run ad hoc:
//
//   node scripts/live-github-audit-probe.mjs [OWNER/REPO]
//
import { createGithubRestClient, collectHistory, assembleAudit } from "@beetlejuice/github";
import { TenantLedger } from "@beetlejuice/core";
import { buildReportFromCoreAudit } from "../apps/cli/src/audit.js";
import { renderMarkdownReport } from "../apps/cli/src/report/markdown.js";

const spec = process.argv[2] ?? "eubby06/kids-store";
const [owner, repo] = spec.split("/");
if (!owner || !repo) {
  console.error("usage: node scripts/live-github-audit-probe.mjs OWNER/REPO");
  process.exit(2);
}

const evidence = await collectHistory({
  repoConfig: { owner, repo },
  // No token: works for public repositories within the unauthenticated rate
  // limit. Supply { token } for private repositories.
  client: createGithubRestClient({}),
  policy: { botActors: ["copilot-swe-agent[bot]", "next-js-bot[bot]"], branchPrefixes: ["copilot/", "forge/", "beetlejuice/"] },
  limits: { maxPrPages: 3, maxRunPages: 1, maxCommitPagesPerPr: 1, maxCheckShaCount: 10 },
});

console.error(`live GET requests: ${evidence.collection.requests.length}`);
const { events, stats } = assembleAudit(evidence);
console.error(`prs: ${evidence.prs.length} -> canonical events: ${events.length} (known µ$: ${stats.costs.known_micro_usd_total})`);
if (events.length === 0) {
  console.error("no canonical events reconstructed for this policy/repository");
  process.exit(9);
}

const ledger = new TenantLedger(`live-probe:${owner}/${repo}`);
ledger.appendAll(events);
const envelope = ledger.exportCoreAudit({ producer: `live-github-audit-probe (${owner}/${repo})` });
const report = buildReportFromCoreAudit(envelope, { mode: "real-github-read-only" });
process.stdout.write(renderMarkdownReport(report));
