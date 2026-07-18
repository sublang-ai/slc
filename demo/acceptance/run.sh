#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
#
# Run the compiled demo workflow over the seeded repository with real agents,
# capturing the evidence demo/acceptance/check.mjs validates.
#
# Usage: demo/acceptance/run.sh [<work-dir>]
#
#   <work-dir>     target repository (default: ${TMPDIR:-/tmp}/slc-demo-run,
#                  outside this repository; recreated by setup.sh)
#
# Environment:
#   PLAYBOOK_BIN   playbook launcher (default: playbook; use playbook-dev
#                  against sibling working copies)
#   CODER_AGENT    coder agent spec  (default: claude:claude-sonnet-5)
#   REVIEWER_AGENT reviewer agent spec (default: codex:gpt-5.6-terra)
#   CAPTAIN_AGENT  captain/judge spec (default: claude:claude-sonnet-5)
#   DEMO_TASK      Boss task (default: fix the seeded median bug)

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${1:-${TMPDIR:-/tmp}/slc-demo-run}"

PLAYBOOK_BIN="${PLAYBOOK_BIN:-playbook}"
CODER_AGENT="${CODER_AGENT:-claude:claude-sonnet-5}"
REVIEWER_AGENT="${REVIEWER_AGENT:-codex:gpt-5.6-terra}"
CAPTAIN_AGENT="${CAPTAIN_AGENT:-claude:claude-sonnet-5}"
DEMO_TASK="${DEMO_TASK:-stats.js 里的 median 函数有 bug：结果依赖元素顺序，偶数长度数组也算错。请修复它，使 node test.js 通过。}"

"$here/setup.sh" "$work"

# Evidence lives BESIDE the work repository, not inside it: a growing log in
# the worktree is a legitimate review finding, and the reviewer will keep
# raising it every round.
evidence="$work.evidence"
rm -rf "$evidence"
mkdir -p "$evidence"

echo "launching: coder=$CODER_AGENT reviewer=$REVIEWER_AGENT captain=$CAPTAIN_AGENT"
(
  cd "$work"
  "$PLAYBOOK_BIN" run "$here/../registry.ts" "$DEMO_TASK" \
    --player "编码者=$CODER_AGENT" \
    --player "审查者=$REVIEWER_AGENT" \
    --captain "$CAPTAIN_AGENT" \
    --json --verbose \
    > "$evidence/run.json" 2> "$evidence/run.log"
  echo $? > "$evidence/run.exit"
)

echo "run exit: $(cat "$evidence/run.exit")"
echo "evidence: $evidence/run.json, $evidence/run.log"
echo "validate: node $here/check.mjs --run-dir $work"
