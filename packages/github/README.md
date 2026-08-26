# @beetlejuice/github — Read-Only Ingestion Adapter (WC-002)

Turns GitHub Actions / pull-request / check-run history into **vendor-neutral
canonical AGENTIC_TASK evidence** without making GitHub the domain model.

This package is deliberately self-contained (zero runtime dependencies) so its
fixture-backed pipeline runs hermetically. At integration time the emitted raw
canonical events are appended to `@beetlejuice/core`'s `TenantLedger.append()`,
which validates and stamps them with the four version fields
(`schema_version`, `event_version`, `collector_version`,
`normalization_version`). Adapter provenance additionally travels inside every
event's `source.meta`.

## What it produces

One agentic pull request becomes one task:

```
task_started -> pull_request_created
  -> execution_started(rev1) -> ... superseded by ...
  -> execution_started(revN) -> execution_finished(completed|aborted)
     (open PRs stay running — unresolved outcomes are reported, never guessed)
pull_request_merged | pull_request_closed
```

CI workflow runs become `ci_run_recorded`, terminal Actions **jobs** of
correlated runs become `compute_usage_recorded` (the unit GitHub actually
bills), check runs become `validation_recorded`, each correlated with explicit
confidence states:

| Confidence | Evidence |
|---|---|
| `explicit` | GitHub itself linked the run to an ingested PR (`workflow_run.pull_requests`) |
| `inferred` | head-branch/head-SHA equality matched exactly one ingested PR |
| excluded   | no defensible link: counted in `stats.counts.*_excluded_by_reason` — never force-attached |

Model/tool invocation spend is **not observable** through read-only GitHub
evidence, so it is never emitted and never estimated.

### Actions jobs = measured compute evidence

GitHub bills Actions per **job-minute**, and job timing is directly observable
through read-only APIs (`GET /repos/{owner}/{repo}/actions/runs/{id}/jobs`).
The sweep therefore fetches jobs **only for runs that correlate to an ingested
agentic task** (foreign-branch runs get no request), bounded by
`limits.maxJobPagesPerRun`, and maps terminal jobs to `compute_usage_recorded`
events bound to their revision execution when the run head SHA is a known
revision. Jobs of an in-progress run or an unmapped-conclusion run still carry
their compute — compute was consumed regardless of how the run-level record
maps. Event ids use the globally-unique job id alone, so sweep + webhook
ingestion are idempotent for identical evidence.

## Normalized v2 bundle for the product surface (`--input` seam)

`buildNormalizedBundle()` turns collected evidence into the versioned,
vendor-neutral `agentic_task` bundle envelope the product CLI consumes via
`--input` (contract: `apps/cli/docs/NORMALIZED_INPUT.md`, schema v2):

```js
import { collectHistory, buildNormalizedBundle, actionsMeasuredCostSource } from '@beetlejuice/github';

const evidence = await collectHistory({ repoConfig: { owner, repo }, policy, token });
const bundle = buildNormalizedBundle(evidence, {
  // measured CI from usage records + measured compute from collected job
  // timing, with the double-count guard; unknowns stay precise otherwise.
  costSource: actionsMeasuredCostSource({
    usageByAttempt: usage,
    rateUsdPerMinute: 0.008,
    labelMultipliers: { 'windows-latest': 2 },
  }),
});
// bundle.schema_version === "2", plus collector/normalization provenance.
// Write bundle.records to a file and feed apps/cli --input <file>.
```

Guarantees (enforced by `test/bundle.test.js`, which pins the documented
consumer contract):

- **No raw provider payloads.** Keys like `workflow_run`, `pull_request`,
  `head_sha`, `html_url` or `repository` never appear anywhere in the bundle —
  the product validator rejects such input outright. Identifiers are
  tenant-scope refs only (`t:pr:N`, `t:pr:N:rev:<sha>`); repository coordinates
  do not enter the bundle at all.
- **Cost accounting invariant holds by construction:** each execution's
  `total_amount_micro_usd` equals exactly the sum of its representable
  components; unavailable components carry `amount_micro_usd: null`.
  Inference/tools are always `unavailable` (not observable read-only); CI is
  `measured` only where operator-supplied Actions usage + an explicit rate
  resolve known money; compute is `measured` only from collected job timing ×
  an explicit rate (guarded against run-level usage overlap).
- **Outcome attribution stays conservative:** merged → `accepted`,
  closed-unmerged → `aborted` (+`aborted_at`), open → `unresolved`. Success is
  never guessed; `failed` is never claimed from close evidence alone.
- **No fabricated certain waste.** Bare revision succession is normal
  iteration, so NO `superseded_by_execution_id` / `retry_of_execution_id`
  relations are emitted from it — the product's certain-waste rules have
  nothing to misfire on. Known money whose revision binding is unprovable rolls
  up onto its own task's final execution (counted in `collection_stats`) so
  totals stay complete without inventing bindings.
- **Same correlation decisions as the event audit.** The bundle reuses
  `map/pr-tasks.js` / `map/ci-evidence.js` / `policy.js`; both seams cannot
  drift apart. Exclusions/pending/unknowns are itemized in
  `bundle.collection_stats` with precise reasons.
- **Deterministic output:** identical evidence yields byte-identical JSON
  (deep-frozen, JSON-clean, stable ordering).

## Fixture mode (no credentials, no network)

```js
import { collectHistory, assembleAudit, actionsUsageCostSource } from '@beetlejuice/github';

const evidence = await collectHistory({
  repoConfig: { owner: 'acme-factory', repo: 'line-controller' },
  policy: { botActors: ['forge-bot[bot]'], branchPrefixes: ['forge/'] },
  fetchImpl: myInMemoryGitHubTransport, // see test/e2e-fixture-audit.test.js
});

const { events, stats } = assembleAudit(evidence, {
  costSource: actionsUsageCostSource({ usageByAttempt: usageMap, rateUsdPerMinute: 0.008 }),
});
// events -> TenantLedger.appendAll(events)
```

`npm test` runs the whole suite this way.

## Real read-only mode (credentials required)

```js
import { collectHistory } from '@beetlejuice/github';

const evidence = await collectHistory({
  repoConfig: { owner, repo },
  policy,
  token: process.env.BEETLEJUICE_GITHUB_TOKEN, // fine-grained PAT or App installation token
});
```

Hard guarantees enforced in code (`src/collect/client.js`):

- **GET is the only HTTP method the adapter can issue** — anything else throws
  `READ_ONLY_VIOLATION` before any I/O. The initial audit needs **no write
  permission whatsoever**.
- Credentials never appear in error messages (`redactSecret()`).
- Sweeps are bounded (`limits.maxPrPages`, `maxRunPages`,
  `maxCommitPagesPerPr`, `maxCheckShaCount`) and truncation is reported in
  `stats.notes`.
- Data minimization: check-runs are probed **only** for revisions of ingested
  agentic PRs; foreign branches are never fetched.

### Classification policy: explicit, environment or documented defaults

The adapter never guesses which pull requests are agentic: `collectHistory`
requires an explicit `{ botActors, branchPrefixes }` policy and an empty
policy ingests nothing. To make unattended real-mode runs practical (audit
finding A12), the adapter also resolves that policy from the environment:

```js
import { resolveAgenticPolicyFromEnv } from '@beetlejuice/github';

// { botActors, branchPrefixes } — exactly the shape collectHistory accepts.
const policy = resolveAgenticPolicyFromEnv(process.env);
```

Resolution per dimension (actors and branch prefixes are independent):

- env var **unset** → documented conservative default:
  `SUGGESTED_AGENTIC_ACTORS` (well-known coding-agent bot identities) /
  `DEFAULT_AGENTIC_BRANCH_PREFIXES` (`beetlejuice/`, `claude/`, `codex/`,
  `copilot/`, `cursor/`, `devin/`, `jules/`);
- env var set to **empty string** → explicit opt-out: that dimension matches
  nothing;
- env var set otherwise → comma-separated entries (trimmed; empty fragments
  dropped; whitespace inside an entry fails fast naming the variable).

| Variable | Meaning |
|---|---|
| `BEETLEJUICE_BOT_ACTORS` | comma-separated bot logins counted as agentic authors |
| `BEETLEJUICE_BRANCH_PREFIXES` | comma-separated head-branch prefixes counted as agent-shaped |

Honesty guarantees unchanged by resolution:

- actor allowlist hits stay confidence `measured`; prefix hits stay
  `inferred`; non-matches are excluded and counted — the defaults only
  recognize well-known agent identities, they never widen what counts as
  evidence or cost;
- malformed values throw before any network I/O;
- callers that accept both a hand-written policy object and environment
  resolution should prefer the explicit object and use
  `resolveAgenticPolicyFromEnv()` only as the fallback — precedence belongs to
  the calling surface (the product CLI owns its own wiring).

**External validation gap (narrow):** all HTTP behavior is tested against an
injected transport. The single untested path is the live TLS call to
`https://api.github.com` itself, which requires a real credential. Operators
can validate it with one command once a token exists:

```
BEETLEJUICE_GITHUB_TOKEN=… node -e "import('@beetlejuice/github').then(async m => {
  const ev = await m.collectHistory({ repoConfig:{owner:process.argv[1],repo:process.argv[2]},
    policy:{botActors:[],branchPrefixes:['forge/']}, token:process.env.BEETLEJUICE_GITHUB_TOKEN });
  console.log('pulls seen:', ev.prs.length);
})" OWNER REPO
```

## GitHub App authentication (P1 prototype surface)

The preferred credential is a **GitHub App installation token**: least
privilege by construction (permissions live in the App manifest, never in
code), short-lived and scoped to exactly one installation.

```js
import { createGithubAppAuth, createGithubRestClient, privateKeyFromEnvString } from '@beetlejuice/github';

const auth = createGithubAppAuth({
  appId: process.env.BEETLEJUICE_GITHUB_APP_ID,
  // single-line PEM from your secret store; literal "\n" escapes are handled:
  privateKey: privateKeyFromEnvString(process.env.BEETLEJUICE_GITHUB_APP_KEY_PEM),
});
const { token } = await auth.createInstallationToken({ installationId: 42 });

const client = createGithubRestClient({ token }); // strictly GET-only reads
```

How it works (all hermetically tested in `test/app-auth.test.js`):

1. `createGithubAppAuth` signs a small RS256 JWT asserting the App id
   (`{ iat, exp, iss }`, lifetime clamped to GitHub's 10-minute maximum).
2. It POSTs that JWT to `/app/installations/{id}/access_tokens` and returns
   the minted installation token.
3. The token feeds the GET-only REST client above. Repository access remains
   exclusively read-only — the exchange endpoint itself grants no write
   permission and performs no repository operation.

Secret-handling guarantees enforced in code:

- the private key, JWT and installation tokens can **never** surface in error
  messages or thrown details (`redactSecret()` on every failure path);
- tokens are not cached; every exchange yields a fresh expiring credential;
- malformed PEM / ids fail fast before any network I/O.

### Credential / environment setup

| Variable | Used by | Meaning |
|---|---|---|
| `BEETLEJUICE_GITHUB_TOKEN` | real-mode sweep | fine-grained PAT or App installation token (read-only) |
| `BEETLEJUICE_GITHUB_APP_ID` | App auth | numeric App id |
| `BEETLEJUICE_GITHUB_APP_KEY_PEM` | App auth | private key PEM (single-line `\n`-escaped accepted) |
| `BEETLEJUICE_BOT_ACTORS` | policy resolution | comma-separated agentic bot logins (unset = suggested defaults, empty = opt-out) |
| `BEETLEJUICE_BRANCH_PREFIXES` | policy resolution | comma-separated agent branch prefixes (unset = documented defaults, empty = opt-out) |
| webhook secret | webhook receiver | HMAC-SHA256 shared secret for delivery verification |

None of these is required for fixture tests; nothing here reads them implicitly.

## GitHub App prototype surface (P1)

Least-privilege repository permissions for the observation phase — nothing
else is requested:

| Permission | Access | Why |
|---|---|---|
| Metadata | Read-only | mandatory baseline |
| Actions | Read-only | workflow runs + jobs (CI/compute evidence) |
| Checks | Read-only | check runs (validation evidence) |
| Contents | Read-only | PR commits / revision SHAs |
| Pull requests | Read-only | lifecycle + outcome signals |
| Issues | No access | not needed for V1 audit |
| *any write permission* | **none** | initial audit must never require writes |

### Webhook verification

```js
import { verifyWebhookSignature, normalizeWebhookDelivery } from '@beetlejuice/github';

verifyWebhookSignature({
  payloadBody: rawRequestBody,          // exact bytes
  signatureHeader: req.headers['x-hub-signature-256'],
  secret: config.webhookSecret,         // HMAC-SHA256, timing-safe compare
});

const { delivered, ignored } = normalizeWebhookDelivery({
  event: req.headers['x-github-event'],
  action: body.action,
  payload: parsedBody,
  repoConfig: { owner, repo },          // installation scoping guard
  policy,                               // same classification policy as audits
  prIndex,                              // ingested-task index (buildPrIndex)
});
// delivered -> TenantLedger.appendAll(...); ignored.reason explains deferrals
```

Incremental deliveries share ONE correlation/mapping layer with historical
audits (`map/pr-index.js`, `map/ci-evidence.js`, `map/workflow-jobs.js`), emit
identical tenant-scoped event ids for identical evidence (idempotent
re-ingestion), and defer what a delivery alone cannot prove (revision sweeps
fill those in) with explicit machine-readable reasons. Deliveries for other
repositories are ignored whole. Supported events: `pull_request`,
`workflow_run`, `check_run`, `workflow_job` (a completed job delivery binds by
head SHA through the shared index and reuses the exact sweep mapper).

## Cost semantics

Money is integer micro-USD. A cost is either:

- **measured** — computed ONLY from explicit inputs times an explicitly
  configured rate:
  - `ci_run_recorded`: operator-supplied Actions usage records
    (`billable_ms` per run attempt) × `rateUsdPerMinute`
    (`actionsUsageCostSource`);
  - `compute_usage_recorded`: collected Actions job wall-clock time, billed as
    GitHub bills it — each job's elapsed time rounded UP to whole minutes —
    × `rateUsdPerMinute` × a runner-label multiplier table (default 1x;
    e.g. `{ "windows-latest": 2 }`) via `actionsMeasuredCostSource`.
    Attempts already covered by a run-level usage record resolve to unknown
    instead of money, so combining both evidence classes can NEVER
    double-count by construction.
- **unknown** — `{ known: false, reason }` with a precise reason string; the
  default seam source (`unavailableEvidenceCostSource()`) answers each evidence
  kind with its own reason.

Nothing in this package ever guesses a dollar amount.

## Privacy / scope boundary

Raw GitHub coordinates (owner/name, PR number, SHA, run id) exist only inside
tenant/source-scoped refs, `source.ref` provenance and `event_id`. Enforced by
tests (`test/privacy-scope-boundary.test.js`):

- repository coordinates appear ONLY in provenance fields;
- output is fully parameterized by its scope string — two repositories produce
  structurally identical audits modulo those strings (no hidden fingerprint,
  hash or stable global id anywhere);
- the public surface exposes no hashing/global-exporter capability.

This package never talks to the global learning layer; that boundary belongs
to the privacy lane's gate/exporter.
