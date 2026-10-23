#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

# The pre-push check (continuous-integration-10, DR-060): no conflict
# marker in the tree, then the spec lint and the TypeScript type check.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
pattern='^(<<<<<<< |=======$|>>>>>>> )'
if git grep -nE "$pattern" > /dev/null 2>&1; then
  echo "prepush: conflict markers left in the tree:" >&2
  git grep -nE "$pattern" >&2
  exit 1
fi
npx @sublang/spex lint
npm run -s typecheck
echo "prepush: clean"
