#!/usr/bin/env bash
set -uo pipefail

ensure_path() {
  for dir in "$HOME/.opencode/bin" "$HOME/.local/bin"; do
    if [[ -d "$dir" ]]; then
      export PATH="$dir:$PATH"
      if [[ -n "${GITHUB_PATH:-}" ]]; then
        echo "$dir" >> "$GITHUB_PATH"
      fi
    fi
  done
}

verify_opencode() {
  ensure_path
  if command -v opencode >/dev/null 2>&1; then
    echo "OpenCode ready: $(command -v opencode)"
    opencode --version || true
    return 0
  fi
  return 1
}

if verify_opencode; then
  exit 0
fi

INSTALLER=$(mktemp)
trap 'rm -f "$INSTALLER"' EXIT

for attempt in 1 2 3 4 5; do
  echo "OpenCode installer attempt ${attempt}/5"
  rm -f "$INSTALLER"
  if curl --connect-timeout 20 --max-time 120 --retry 2 --retry-all-errors --retry-delay 5 \
      -fsSL https://opencode.ai/install -o "$INSTALLER"; then
    if bash "$INSTALLER" && verify_opencode; then
      exit 0
    fi
  fi
  sleep $((attempt * 10))
done

# Official fallback documented by OpenCode. This avoids depending on the
# install script's separate version-discovery endpoint when that endpoint is flaky.
echo "Install script remained unavailable; falling back to npm package opencode-ai."
if command -v npm >/dev/null 2>&1; then
  for attempt in 1 2 3; do
    echo "OpenCode npm fallback attempt ${attempt}/3"
    if npm install -g opencode-ai && verify_opencode; then
      exit 0
    fi
    sleep $((attempt * 15))
  done
fi

echo "::error::OpenCode installation failed through both the official installer and npm fallback."
exit 1
