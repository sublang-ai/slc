<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Reproduce the current compiler environment

This recipe reconstructs the measured C10 compiler and the retained Playbook definitions from committed source and locked dependencies. It includes the private runtime correction used by the CODE/DEV experiments. Package metadata remains Playbook 13.2.0; these patched bytes are not an unmodified registry install. See the [verification results](compilation-verification.md) for the accepted measurements and their scopes.

The setup pins SLC `092e242d134e8681109ec390a9c9707476a79b36`, Playbook `69ed4ab4d94ed0bd218db9e0d375828a67f57cc0`, and runtime correction `4b51a7edfd2670f6a4cb4f23285a897ae836e612`. It verifies the stock runtime preimages before applying the two committed runtime files, rebuilds SLC, and checks the resulting pipeline definitions. It installs privately and makes no provider call.

Run from the SLC checkout with Node >=23.6, npm registry access, and both Git repositories available. The defaults are `/Users/basicthinker/Projects/SubLang/slc` and `/Users/basicthinker/Projects/SubLang/playbook`; `SLC_REPO` and `PLAYBOOK_REPO` override them. Keep this shell session for the later commands.

```bash
set -euo pipefail
repro=$(mktemp -d /private/tmp/slc-reproduction.XXXXXX)
SLC_REPRO_ROOT="$repro/environment" RUN_NPM_INSTALL=1 \
  bash scripts/reproduce-compilation-c10.sh
compiler="$repro/environment/slc"
pipelines="$repro/environment/playbook-13.2-common-v13-full"
mkdir "$repro/work"
ln -s "$compiler/node_modules" "$repro/work/node_modules"
cat > "$repro/work/package.json" <<'JSON'
{"private":true,"type":"module"}
JSON
cat > "$repro/empty.yaml" <<'YAML'
{}
YAML
cd "$repro/work"
```

The `full` pipeline contains the exact retained materializer preference. The setup also produces a baseline pipeline without the helper instructions for controlled comparison. Fresh proof hashes differ from historical proof hashes because their absolute paths differ; semantic input bytes are checked directly.

Define an ordinary CLI wrapper with the measured model settings. Existing Claude Code authentication with access to Opus 5 is required for the compilation commands. `SLC_PIPELINE_PATH` names the parent containing `playbook/`.

```bash
slc_local() {
  env -u SLC_REVIEWER_AGENT -u SLC_REVIEWER_MODEL \
    -u SLC_REVIEWER_EFFORT -u SLC_REVIEWER_FAST_MODE \
    SLC_AGENT=claude-code SLC_MODEL=claude-opus-5 SLC_EFFORT=low \
    SLC_FAST_MODE=false SLC_PIPELINE_PATH="$pipelines" \
    node "$compiler/dist/cli.js" --config "$repro/empty.yaml" "$@"
}
slc_local --version
slc_local --help
set +e
```

The following command calls the provider and compiles the minimal demo through the ordinary pipeline with optimization enabled:

```bash
cat > minimal.txt <<'SOURCE'
Before work begins, ensure the current directory is the root of its own Git repository; if .git is absent there, initialize a repository there.
Use one agent to carry out the input task.
The agent modifies the code in the current directory as the task requires and commits the result to Git.
SOURCE
slc_local playbook "$repro/work/minimal.txt"
```

For CODE or DEV, copy the exact committed clean source from the clarification corpus and run its command. The corpus manifest and scoring oracles stay outside the working directory.

```bash
cp "$compiler/docs/performance/clarification-corpus/sources/case-001/source.md" code.md
slc_local playbook "$repro/work/code.md"

cp "$compiler/docs/performance/clarification-corpus/sources/case-010/source.md" dev.md
slc_local playbook "$repro/work/dev.md"
```

Run the workflows sequentially. Outputs appear in the current directory as `<name>.playbook/` and `<name>.ts`. Clarification writes one structured stderr report and exits 2; edit the original source and repeat the identical command. Successful unchanged reruns can reuse incremental history; use a fresh working directory for a cold measurement. Compilation and execution are separate: the generated workflow acts on its working directory only when you run it.

The preliminary clean reconstruction at `/private/tmp/slc-c10-v13-reproduction-work.6y74lE` installed 318 packages, built successfully, reproduced all 178 C10 `dist/` files byte-for-byte, and passed actual CLI version/help checks without a provider call. The final retained-definition reconstruction at `/private/tmp/slc-c10-v13-reproduction-work.Zc5RCn` also passes, including the exact retained link definition, both committed source hashes, explicit one-agent configuration, CLI checks and all 178 compiled files; see [delivery evidence](performance/current-reproduction-2026-09-14.json). Setup verification is not another compilation timing observation. The accepted CODE comparison is a fixed-FSM link pair with resumed phase-chain correctness, while the simple demo's five-minute result is a separate cold full run.
