#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
#
# Seed the demo target repository: a tiny project with a known median bug.
#
# Usage: demo/reference/setup.sh [<work-dir>] [--init]
#
#   <work-dir>  target directory (default: ${TMPDIR:-/tmp}/slc-demo-run —
#               outside this repository, so the agents see only the demo
#               project, not slc's own instructions). Recreated from scratch
#               with a copy of demo/sample.c.
#   --init      also `git init` and commit the seed state. Without it the
#               directory is deliberately NOT a Git repository, so the
#               compiled playbook's agent-free setup step initializes it.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${1:-${TMPDIR:-/tmp}/slc-demo-run}"
init=0
for arg in "$@"; do [ "$arg" = "--init" ] && init=1; done
case "$work" in --init) work="${TMPDIR:-/tmp}/slc-demo-run" ;; esac

rm -rf "$work"
mkdir -p "$work"
cp "$here/../sample.c" "$work/"

if [ "$init" -eq 1 ]; then
  git -C "$work" init -q
  git -C "$work" add sample.c
  git -C "$work" -c user.name="Demo Seed" -c user.email="demo@sublang.ai" \
    commit -qm "chore: seed buggy sample fixture"
fi

echo "demo repo ready at: $work (git: $([ -d "$work/.git" ] && echo initialized || echo absent))"
