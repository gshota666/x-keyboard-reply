#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  ""|--install-browser) ;;
  *) echo "Usage: bash tests/run-smoke.sh [--install-browser]" >&2; exit 2 ;;
esac

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/xkr-smoke.XXXXXX")"
session="$(basename "$scratch")"

pw() {
  npx --yes --package @playwright/cli@0.1.23 playwright-cli -s="$session" "$@"
}

cd -- "$scratch"
cleanup() {
  pw close >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT

node - "$root" <<'JS' > browser.json
const extension = process.argv[2];
console.log(JSON.stringify({
  browser: {
    browserName: "chromium",
    launchOptions: {
      channel: "chromium",
      headless: true,
      args: ["--disable-extensions-except=" + extension, "--load-extension=" + extension],
      ignoreDefaultArgs: ["--disable-extensions"],
    },
    contextOptions: { viewport: { width: 1024, height: 720 } },
  },
}));
JS

if [[ "${1:-}" == --install-browser ]]; then
  pw install-browser chromium
fi
pw open about:blank --persistent --profile "$scratch/profile" --config "$scratch/browser.json"
pw run-code --filename "$root/tests/smoke.js" --raw
