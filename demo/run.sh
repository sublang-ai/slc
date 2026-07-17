#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
#
# Run the compiled demo workflow over the seeded repository with real agents,
# capturing the evidence demo/check.mjs validates.
#
# Usage: demo/run.sh [<work-dir>]
#
#   <work-dir>     target repository (default: demo/run; recreated by setup.sh)
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
work="${1:-$here/run}"

PLAYBOOK_BIN="${PLAYBOOK_BIN:-playbook}"
CODER_AGENT="${CODER_AGENT:-claude:claude-sonnet-5}"
REVIEWER_AGENT="${REVIEWER_AGENT:-codex:gpt-5.6-terra}"
CAPTAIN_AGENT="${CAPTAIN_AGENT:-claude:claude-sonnet-5}"
DEMO_TASK="${DEMO_TASK:-stats.js 里的 median 函数有 bug：结果依赖元素顺序，偶数长度数组也算错。请修复它，使 node test.js 通过。}"

"$here/setup.sh" "$work"

echo "launching: coder=$CODER_AGENT reviewer=$REVIEWER_AGENT captain=$CAPTAIN_AGENT"
(
  cd "$work"
  "$PLAYBOOK_BIN" run "$here/registry.ts" "$DEMO_TASK" \
    --player "编码者=$CODER_AGENT" \
    --player "审查者=$REVIEWER_AGENT" \
    --captain "$CAPTAIN_AGENT" \
    --json --verbose \
    > run.json 2> run.log
  echo $? > run.exit
)

echo "run exit: $(cat "$work/run.exit")"
echo "evidence: $work/run.json, $work/run.log"
echo "validate: node $here/check.mjs --run-dir $work"
