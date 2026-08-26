#!/usr/bin/env bash
set -uo pipefail

REAL="${OPENCODE_BIN:-$HOME/.opencode/bin/opencode}"
MAX_ATTEMPTS="${OPENCODE_MAX_ATTEMPTS:-6}"
RETRY_DELAY="${OPENCODE_RETRY_DELAY_SECONDS:-180}"
NETWORK_STALL_SECONDS="${OPENCODE_NETWORK_STALL_SECONDS:-420}"
LOG="$(mktemp)"
STALL_FLAG="$(mktemp)"
CONTROL_ACTIVE=false
CHILD_PID=""
MONITOR_PID=""
START_HEAD=""

# Ox is the only model allowed in the Beetlejuice autonomous factory. Provider
# or transport failures are retried on Ox; we never silently substitute another
# model merely to obtain a green workflow.
OX_MODEL="opencode/x-preview-f-free"

# Retry transport/provider failures, including OpenCode's generic server-side
# UnknownError. Deterministic agent/code failures intentionally do not match.
NETWORK_RE='(network_error|NetworkError|network error|fetch failed|APIConnectionError|UnknownError|Unexpected server error|internal server error|server error.*check server logs|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|ENOTFOUND|ETIMEDOUT|timed out|timeout|socket hang up|connection (reset|refused|closed|error)|upstream.*(reset|closed|unavailable|error)|HTTP[^0-9]*(429|500|502|503|504)|status[^0-9]*(429|500|502|503|504)|too many requests|rate.?limit|service unavailable|bad gateway|gateway timeout|temporar(y|ily) unavailable|TLS|SSL.*error)'

RUN_ARGS=("$@")
MODEL_VALUE_INDEX=-1
CURRENT_MODEL=""
for ((i=0; i<${#RUN_ARGS[@]}; i++)); do
  if [[ "${RUN_ARGS[$i]}" == "--model" && $((i + 1)) -lt ${#RUN_ARGS[@]} ]]; then
    MODEL_VALUE_INDEX=$((i + 1))
    CURRENT_MODEL="${RUN_ARGS[$MODEL_VALUE_INDEX]}"
    break
  fi
done

# Enforce Ox even if a stale workflow or manual invocation passes another model.
if [[ "$MODEL_VALUE_INDEX" -ge 0 ]]; then
  if [[ "$CURRENT_MODEL" != "$OX_MODEL" ]]; then
    echo "::warning::Ignoring non-Ox model '$CURRENT_MODEL'; Beetlejuice factory is Ox-only."
    RUN_ARGS[$MODEL_VALUE_INDEX]="$OX_MODEL"
  fi
  CURRENT_MODEL="$OX_MODEL"
fi

CONTROL_PATHS=(
  "AGENTS.md"
  ".opencode/agents"
  "docs/MASTER_PROMPT_ORIGINAL_FR.md"
  "docs/MASTER_PROMPT.md"
  "docs/PRODUCT_OBJECTIVE.md"
  "docs/agents"
  "docs/workcards"
  ".github/scripts/run-opencode-with-retry.sh"
)

restore_path_from_head() {
  local path="$1"
  git reset -q HEAD -- "$path" 2>/dev/null || true
  if git cat-file -e "HEAD:$path" 2>/dev/null; then
    git checkout -q -- "$path" 2>/dev/null || true
  else
    rm -rf -- "$path"
  fi
  git clean -fdq -- "$path" 2>/dev/null || true
}

restore_control_plane() {
  [[ "$CONTROL_ACTIVE" == true ]] || return 0
  for path in "${CONTROL_PATHS[@]}"; do restore_path_from_head "$path"; done
  CONTROL_ACTIVE=false
}

cleanup() {
  [[ -n "$MONITOR_PID" ]] && kill "$MONITOR_PID" 2>/dev/null || true
  [[ -n "$CHILD_PID" ]] && kill "$CHILD_PID" 2>/dev/null || true
  restore_control_plane || true
  rm -f "$LOG" "$STALL_FLAG"
}
trap cleanup EXIT INT TERM

stage_control_plane() {
  local source_ref="origin/main"
  if ! git fetch -q origin main; then
    echo "::warning::Unable to refresh origin/main control plane; using current checkout."
    source_ref="${GITHUB_SHA:-HEAD}"
  fi
  for path in "${CONTROL_PATHS[@]}"; do
    if git cat-file -e "$source_ref:$path" 2>/dev/null; then
      git checkout -q "$source_ref" -- "$path"
    fi
  done
  CONTROL_ACTIVE=true

  rm -rf /tmp/beetlejuice_control
  mkdir -p /tmp/beetlejuice_control
  for path in AGENTS.md .opencode/agents docs/MASTER_PROMPT_ORIGINAL_FR.md docs/MASTER_PROMPT.md docs/PRODUCT_OBJECTIVE.md docs/agents docs/workcards; do
    if [[ -e "$path" ]]; then
      mkdir -p "/tmp/beetlejuice_control/$(dirname "$path")"
      cp -a "$path" "/tmp/beetlejuice_control/$path"
    fi
  done
}

validate_agent_card() {
  local requested="" prev="" arg marker count
  local registry="docs/agents/AGENT_CARDS.md"
  [[ -f "$registry" ]] || { echo "::error::Missing $registry" >&2; return 64; }

  for arg in "$@"; do
    if [[ "$prev" == "--agent" ]]; then requested="$arg"; break; fi
    case "$arg" in --agent=*) requested="${arg#--agent=}"; break;; esac
    prev="$arg"
  done
  [[ -n "$requested" ]] || return 0
  count=$(grep -Fc "<!-- AGENT_CARD: ${requested} " "$registry" || true)
  [[ "$count" -eq 1 ]] || { echo "::error::Agent '$requested' has $count canonical cards; expected 1." >&2; return 65; }
  [[ -f ".opencode/agents/${requested}.md" ]] || { echo "::error::Missing agent definition for $requested" >&2; return 66; }
}

stage_control_plane
START_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
validate_agent_card "${RUN_ARGS[@]}" || exit $?

run_once() {
  : > "$LOG"
  rm -f "$STALL_FLAG"
  local workdir="${GITHUB_WORKSPACE:-$PWD}"
  (
    cd "$workdir" || exit 70
    "$REAL" "${RUN_ARGS[@]}"
  ) > >(tee -a "$LOG") 2> >(tee -a "$LOG" >&2) &
  CHILD_PID=$!

  # Watchdog: any completely silent OpenCode process beyond the stall threshold
  # is considered wedged. Kill it and let the outer loop retry Ox from scratch.
  (
    local last_size=0 last_change now size
    last_change=$(date +%s)
    while kill -0 "$CHILD_PID" 2>/dev/null; do
      sleep 15
      size=$(wc -c < "$LOG" 2>/dev/null || echo 0)
      now=$(date +%s)
      if [[ "$size" -ne "$last_size" ]]; then
        last_size="$size"; last_change="$now"
      elif (( now - last_change >= NETWORK_STALL_SECONDS )); then
        echo "BEETLEJUICE_OPENCODE_STALL_DETECTED model=$OX_MODEL after=${NETWORK_STALL_SECONDS}s" | tee -a "$LOG" >&2
        touch "$STALL_FLAG"
        kill "$CHILD_PID" 2>/dev/null || true
        sleep 5
        kill -9 "$CHILD_PID" 2>/dev/null || true
        exit 0
      fi
    done
  ) &
  MONITOR_PID=$!

  wait "$CHILD_PID"; local rc=$?
  kill "$MONITOR_PID" 2>/dev/null || true
  wait "$MONITOR_PID" 2>/dev/null || true
  CHILD_PID=""; MONITOR_PID=""
  [[ -f "$STALL_FLAG" ]] && return 75
  return "$rc"
}

attempt=1
while (( attempt <= MAX_ATTEMPTS )); do
  echo "BEETLEJUICE_OPENCODE_ATTEMPT=$attempt/$MAX_ATTEMPTS model=$OX_MODEL"
  run_once; rc=$?

  if [[ "$rc" -eq 0 ]]; then
    restore_control_plane || exit 1
    if [[ "${BEETLEJUICE_REQUIRE_DELTA:-0}" == "1" ]]; then
      CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
      WORKTREE_DELTA=$(git status --porcelain 2>/dev/null || true)
      if [[ "$CURRENT_HEAD" == "$START_HEAD" && -z "$WORKTREE_DELTA" ]]; then
        echo "::error::BEETLEJUICE_ZERO_DELTA: agent returned success without durable product work." >&2
        exit 67
      fi
    fi
    exit 0
  fi

  if [[ "$rc" -eq 75 ]] || grep -Eiq "$NETWORK_RE" "$LOG"; then
    if (( attempt < MAX_ATTEMPTS )); then
      echo "::warning::Ox/OpenCode transient failure or watchdog stall; retrying Ox after ${RETRY_DELAY}s."
      sleep "$RETRY_DELAY"
      attempt=$((attempt + 1))
      continue
    fi
    echo "BEETLEJUICE_OX_RETRIES_EXHAUSTED attempts=$MAX_ATTEMPTS model=$OX_MODEL" >&2
    restore_control_plane || true
    # Exit non-zero. The Product Factory completes as failed and the Factory
    # Supervisor's workflow_run trigger re-derives continue=true from durable
    # state and launches a fresh factory cycle rather than changing model.
    exit 75
  fi

  echo "OpenCode/Ox failed without a transient-provider signature (rc=$rc). Preserving failure for supervisor/integration." >&2
  restore_control_plane || true
  exit "$rc"
done

restore_control_plane || true
exit 75