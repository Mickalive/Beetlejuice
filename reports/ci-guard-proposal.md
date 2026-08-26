# Proposed CI changes (audit A6/R6 + self-observable CI) — pending `workflows` permission

Status: **STILL PENDING as of cycle 32957437769 close (2026-08-26).** The commit
was re-attempted from the director close session and rejected again with the
identical error; it was dropped from the branch and the content below remains
the exact prepared change. Fresh rejection this cycle:

```
 ! [remote rejected] HEAD -> lab/integration
   (refusing to allow a GitHub App to create or update workflow
    `.github/workflows/ci.yml` without `workflows` permission)
```

Public API at close: `total_count=0` Actions runs ever on `lab/integration`.

## Why this cannot land from the factory environment

The factory credential can push product code but the remote rejects any commit
touching `.github/workflows/*`:

```
! [remote rejected] lab/integration -> lab/integration
  (refusing to allow a GitHub App to create or update workflow
   `.github/workflows/ci.yml` without `workflows` permission)
```

Fresh evidence this cycle: push of `c5e4e99` rejected 2026-08-26; public API
still shows `total_count=0` Actions runs ever on `lab/integration`.

## Why `workflow_dispatch` is the decisive addition

The factory credential CAN already reach the dispatch endpoint — this cycle's
probe returned the *trigger-specific* error, not an authorization error:

```
POST /repos/Mickalive/Beetlejuice/actions/workflows/ci.yml/dispatches {ref:"lab/integration"}
HTTP 422: {"message":"Workflow does not have 'workflow_dispatch' trigger"}
```

GitHub documents that events triggered by a workflow's own token do not start
new runs **with the exception of `workflow_dispatch` and
`repository_dispatch`**. Once the two-line trigger exists, the autonomous loop
can start and observe Product CI on the integration candidate itself — no user
token required — and flip `integration_ci_green` from a real observed run.

**Smallest possible external action: grant the factory App the `workflows`
permission (one setting).** After that, no further human action is needed:
next cycle lands this commit, dispatches CI on `lab/integration`, and reads the
conclusion via the runs API. Alternative single action with identical effect:
merge `lab/integration` → `main` from any workflows-capable/user context
(push-to-main fires CI and fixes the red default branch at once).

## Exact replacement for `.github/workflows/ci.yml` trigger block

```yaml
on:
  pull_request:
  push:
    branches:
      - main
      - lab/integration
  # workflow_dispatch is the documented exception to GitHub's rule that events
  # triggered by a workflow's own token do not start runs: an authenticated
  # dispatch (actions:write) DOES create a run. This lets the autonomous factory
  # start and observe Product CI on the integration candidate without any
  # user-side push. See reports/ci-guard-proposal.md.
  workflow_dispatch:
```

## Exact replacement for the "Require a real test suite" step in `.github/workflows/ci.yml`

```yaml
      - name: Require a real test suite
        shell: bash
        run: |
          set -euo pipefail
          # Count only FIRST-PARTY test files: prune dependencies AND vendored
          # dot-directories (.opencode tooling) so vendored zod tests etc.
          # can never inflate the count (audit A6/R6). The floor of 20 matches
          # the integrated product's real suite scale; scaffolds without
          # product tests cannot pass by counting dependency tests.
          TEST_COUNT=$(find . \
            -path './node_modules' -prune -o \
            -path './.opencode' -prune -o \
            -path '*/node_modules' -prune -o \
            \( -path './.github' -o -path './.git' \) -prune -o \
            -type f \( -path '*/test/*' -o -path '*/tests/*' -o -name '*.test.*' -o -name '*.spec.*' \) \
            -print | wc -l)
          if [[ "$TEST_COUNT" -lt 20 ]]; then
            echo "::error::Fewer than 20 first-party test files found ($TEST_COUNT). A scaffold-only or vacuously-green build is forbidden."
            exit 1
          fi
          echo "Detected $TEST_COUNT first-party test file(s)."
```

## Local verification (re-executed this cycle on head `5799144`)

- First-party guard expression: **59 ≥ 20 → pass** (59 first-party test files).
- Old guard expression: 59 ≥ 1 → pass (the old floor still holds on the real
  product tree; this fix removes the false-green *class*, it does not fix an
  active red).
- On a scaffold-only checkout with no first-party tests: **0 < 20 → fail**
  (vacuous-green hole closes).
