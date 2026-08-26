# Proposed CI test-count guard fix (audit A6/R6) — pending `workflows` permission

## Why this is not landed on the pushed branch

The integration credential for this factory can push product code but the
remote rejected any commit touching `.github/workflows/*`:

```
! [remote rejected] lab/integration -> lab/integration
  (refusing to allow a GitHub App to create or update workflow
   `.github/workflows/ci.yml` without `workflows` permission)
```

Landing this change requires a one-time action by a maintainer (or granting
the factory App the `workflows` permission). The exact content below was
executed locally and behaves correctly: it counts **57** first-party test files
on the integrated tree, versus 149 when vendored `.opencode/node_modules` zod
tests leak into the count (147 of 149 files were vendored — audit E4).

Note: the OLD guard still passes green on the integrated tree because real
product tests exist; this fix removes the false-green *class* of failure, it
does not fix an active red.

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

Verified locally on the integrated tree (`find … | wc -l`): **57 ≥ 20 → pass**.
On a scaffold-only checkout with no first-party tests: **0 < 20 → fail** (the
vacuous-green hole closes).
