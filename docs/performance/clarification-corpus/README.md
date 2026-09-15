<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Source clarification corpus

The [manifest](manifest.json) contains five reviewed families and fifteen cases: clean, one-defect mutant, and byte-identical restored source. CODE, DEV, DECIDE, and REVIEW preserve Playbook `a000e37815024acc8051855adda72fcedbbfcedb` exactly. Support triage is a separate local routing workflow. The [experiment design](../../clarification-corpus-design.md) defines independent semantic scoring, source protection, failure accounting, and full-workflow acceptance.

The manifest is authoring evidence, not a compiler instruction. It includes exact edits and expected unresolved choices. The recorder selects only public source identity fields and copies that source to a fresh neutral `workflow.md`; it does not send the manifest, case labels, or oracles to the performing agent. Runtime and compiler dependency graphs must be frozen separately before a comparison.

Ten clean/restored cases represent five unique positive sources. A successful phase must preserve authored runtime questions; absence of compiler questions alone does not establish success. A mutant must ask about its intended unresolved choice. Timeouts, provider failures, malformed artifacts, and inconclusive judgments retain their own classifications.

From the repository, this command prints recorder help without making a model call:

```bash
node scripts/phase-probe.mjs --help
```

With a validated frozen compiler, explicit pipeline roots, and an empty private configuration, a case can be measured with the following command. **This invokes a real model.** Run cases sequentially and retain every evidence directory.

```bash
node scripts/phase-probe.mjs \
  --compiler-root /path/to/frozen/compiler \
  --pipeline-path /path/to/frozen/pipelines \
  --config /path/to/empty.yaml \
  --manifest docs/performance/clarification-corpus/manifest.json \
  --case case-001 \
  --agent claude-code --model claude-opus-5 --effort low \
  --timeout-seconds 300 --output /path/to/private/evidence
```

The recorder writes its evidence location to stderr. Its own exit code is zero only for accepted phase completion and one otherwise; this is separate from the ordinary SLC CLI's clarification exit code 2. API measurements explicitly record that no CLI process ran. Neither phase completion nor a well-formed question establishes full compilation or runtime correctness.

For the user rerun check, restore only the original source in the stopped run's workspace and repeat the same ordinary compiler command. The fresh restored corpus member is an additional cold observation, not a substitute for that same-directory rerun.
