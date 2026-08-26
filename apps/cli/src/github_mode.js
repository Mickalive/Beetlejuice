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
//     runtime dependencies by design);
//   - upstream/transport failures propagate verbatim as GithubAdapterError
//     messages (credential material redacted by the adapter) with exit code 3;
//   - `fetchImpl` injection exists ONLY for tests/simulation; the CLI itself
//     always uses the real network transport.
//
import { buildReportFromCoreAudit } from "./audit.js";

/** Env var carrying a fine-grained personal access token or App user token. */
export const GITHUB_TOKEN_ENV = "BEETLEJUICE_GITHUB_TOKEN";

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
 * @param {object} [opts.policy]         operator classification policy forwarded to collectHistory
 * @returns {Promise<{ report: object, collection: object }>} report model for renderers
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

  // 1. Read-only historical sweep of the configured repository (strictly GET).
  const evidence = await github.collectHistory({
    repoConfig: { owner, repo },
    token,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(limits ? { limits } : {}),
    ...(policy ? { policy } : {}),
  });

  // 2. Map raw evidence into canonical AGENTIC_TASK events (adapter #1).
  const { events, stats } = github.assembleAudit(evidence);

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
  //    economics are consumed verbatim from packages/core.
  const report = buildReportFromCoreAudit(envelope, { mode: "real-github-read-only" });
  return { report, collection: evidence.collection ?? null, mapping_stats: stats ?? null };
}

/** Markdown mode label registered by the renderer for this surface. */
export const REAL_GITHUB_MODE = "real-github-read-only";
