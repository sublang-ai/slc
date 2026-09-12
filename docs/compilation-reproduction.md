<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Reproduce the measured compilation

The minimal three-line workflow completed a cold compilation and all acceptance checks in **196.601 seconds** with Opus 5 at low effort and no independent Reviewer. The [performance report](compilation-performance.md) separates this measured result from failed experiments and the broader workflow's remaining coverage findings. One successful measurement is not a latency guarantee.

This recipe builds SLC commit `6ba16d093ece135f67a11203e09d4c7f6821e1bd` in a fresh private directory and reconstructs the reviewed Playbook 12.3 definition overlay from Playbook commit `1c5a4e67162ba58ab1e96e0f91df56ae13f39d71`. It invokes that build directly, so a global `slc` executable cannot override it. The installed runtime stays at Playbook 12.3.0; archiving the Playbook authoring commit does not adopt its 13.1 package or runtime. These commands install and publish nothing and change no saved configuration.

Prerequisites are the already installed repository dependency tree, Node >=23.6, and existing Claude Code authentication with access to `claude-opus-5`. Run the setup in one Bash or zsh session; the later commands reuse its variables. Setup is local and makes no provider call.

```bash
set -euo pipefail
slc_repo=/Users/basicthinker/Projects/SubLang/slc
playbook_repo=/Users/basicthinker/Projects/SubLang/playbook
slc_commit=6ba16d093ece135f67a11203e09d4c7f6821e1bd
playbook_commit=1c5a4e67162ba58ab1e96e0f91df56ae13f39d71
source_commit=6ba16d093ece135f67a11203e09d4c7f6821e1bd
repro=$(mktemp -d /private/tmp/slc-reproduction.XXXXXX)
mkdir "$repro/compiler" "$repro/playbook-authoring" "$repro/pipelines" "$repro/work"
git -C "$slc_repo" archive "$slc_commit" | tar -x -C "$repro/compiler"
git -C "$playbook_repo" archive "$playbook_commit" | tar -x -C "$repro/playbook-authoring"
ln -s "$slc_repo/node_modules" "$repro/compiler/node_modules"
ln -s "$slc_repo/node_modules" "$repro/work/node_modules"
cat > "$repro/work/package.json" <<'JSON'
{"private":true,"type":"module"}
JSON
cat > "$repro/empty.yaml" <<'YAML'
{}
YAML
npm --prefix "$repro/compiler" run build
node "$repro/playbook-authoring/scripts/build-link-experiment-12.3.mjs" \
  "$slc_repo/node_modules/@sublang/playbook" \
  "$repro/pipelines/playbook" --full > "$repro/overlay-build.json"
node "$repro/compiler/dist/cli.js" --version
node "$repro/compiler/dist/cli.js" --help
cat > "$repro/work/minimal.txt" <<'SOURCE'
Before work begins, ensure the current directory is the root of its own Git repository; if .git is absent there, initialize a repository there.
Use one agent to carry out the input task.
The agent modifies the code in the current directory as the task requires and commits the result to Git.
SOURCE
git -C "$slc_repo" show "$source_commit:docs/performance/clarified-workflow.txt" > "$repro/work/workflow.txt"
cd "$repro/work"
set +e
```

The version output must be `slc 0.9.0`. The builder fails closed if the installed Playbook version or reviewed definition hashes differ. `SLC_PIPELINE_PATH` below is the **parent** directory containing `playbook/`, not the `playbook/` directory itself. Both the compiler and generated artifacts resolve dependencies through the existing repository `node_modules`; the default link target therefore remains its installed `@sublang/playbook/src/runtime.ts`.

Setup disables shell exit-on-error before compilation so an expected clarification exit 2 leaves the session available for editing and rerunning. Define this ordinary CLI wrapper in the same session. The explicit empty private config prevents cwd/home configuration discovery and first-run seeding. Clearing all Reviewer settings disables the optional second compilation agent; clearing `SLC_FAST_MODE` leaves the provider's ordinary default. Model and effort are explicit for every compilation call. A two-role compiled workflow still contains its two runtime roles.

```bash
slc_local() {
  env -u SLC_REVIEWER_AGENT -u SLC_REVIEWER_MODEL \
    -u SLC_REVIEWER_EFFORT -u SLC_REVIEWER_FAST_MODE -u SLC_FAST_MODE \
    SLC_AGENT=claude-code SLC_MODEL=claude-opus-5 SLC_EFFORT=low \
    SLC_STALL_TIMEOUT=600 SLC_PIPELINE_PATH="$repro/pipelines" \
    node "$repro/compiler/dist/cli.js" --config "$repro/empty.yaml" "$@"
}
```

The next command **does call the provider** and compiles the minimal demo end to end, with optimization enabled by default. It writes `minimal.playbook/` and the runnable `minimal.ts` in the private working directory. The fresh directory makes the first run cold; no five-minute guarantee is implied by this reproduction recipe.

```bash
slc_local playbook "$repro/work/minimal.txt"
```

To compile the explicitly clarified broader two-role workflow instead, use the following command. Run the workloads sequentially. Its source comes from `docs/performance/clarified-workflow.txt` at SLC commit `6ba16d093ece135f67a11203e09d4c7f6821e1bd`; the original 797-byte demo remains unchanged.

```bash
slc_local playbook "$repro/work/workflow.txt"
```

A clarification exits with code 2 and prints questions on stderr. Edit the selected private `.txt` source and repeat its command; the CLI does not ask for terminal answers. Successful unchanged reruns use incremental reuse. Add `--rebuild` only when deliberately measuring another cold compilation. `SLC_STALL_TIMEOUT=600` is an inactivity watchdog, not a total runtime limit. Do not run the generated workflow merely to compile it: executing it is a separate task that acts on its runtime working directory.

Local verification on 2026-09-12 rebuilt the exact SLC commit, reconstructed the overlay, and ran `--version`, `--help`, the actual config resolver, pipeline loader, and artifact dependency resolver without provider calls. Evidence is `/private/tmp/slc-reproduction.NVU2Y8/local-evidence.json` and its sibling `overlay-build.json`; the literal setup/help check is `/private/tmp/slc-final-reproduction-task-input-local-check.log`. Earlier local proofs remain intact. The resolved selection is exactly Claude Code / `claude-opus-5` / low with no Reviewer; the pipeline resolves to the private `pipelines/playbook` directory with `text2gears`, `gears2fsm`, `optimize`, and `link`; runtime resolution points to installed Playbook 12.3. The new producer SHA-256 is `576218f65416b0589197c3543aca4cd087e6d7061a466648df6337864eee9bda`; helper SHA-256 is `0d3163b79757e48abd9e2f90a1156309a572e540d2b458a442a2c14c0ee4c253`.
