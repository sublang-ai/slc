<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Direct-GEARS clarification corpus

This separately reviewed triplet exercises an unresolved semantic choice supplied directly to `playbook.gears2fsm`, under [IR-041](../../../specs/intents/041-real-clarification-corpus.md) and the existing [source clarification contract](../../../specs/packages/clarification.md). It supplements the [fifteen source cases](../clarification-corpus/manifest.json) without changing that manifest. Preparation and deterministic syntax checks are not live model evidence.

The selected GEARS file is the original invocation source. This is a direct later-phase invocation, not a continuation from a text2gears artifact or evidence that a contradiction must escape an earlier phase. A question should appear at the first phase that detects an unresolved choice.

| Case | Member | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `gears-001` | Clean | 2,391 | `1e4caf20c3523ff6b2497ade89f7fd37ffd319c59f0ae5537e2bd477778667de` |
| `gears-002` | One-defect mutant | 2,391 | `ccb83b434a60f258d079bff47a0095fd69050e9e0bf075b833dae03dad7e1460` |
| `gears-003` | Restored, identical to clean | 2,391 | `1e4caf20c3523ff6b2497ade89f7fd37ffd319c59f0ae5537e2bd477778667de` |

The [manifest](manifest.json) supplies public case-selection fields; the separate [oracle](oracles.json) records expected outcomes, exact mutation, and byte/line ranges. The source is a synthetic draft/review workflow, not a maintained Playbook reference. Both roles and all four acting items remain unchanged. The sole mutation changes `success` to `failure` in ROUTE-3's `done` result, while the same approved review still requires a success report and run success. It introduces no malformed result, missing rejection route, unknown actor, or missing concrete runtime value. The question must identify the conflicting terminal outcome and choose neither answer.

Only selected source bytes may enter a fresh provider workspace, under the neutral filename used by the recorder. Keep this directory's manifest, oracle, case labels, tests, and documentation outside that workspace. Runtime and compiler graphs must be frozen separately. The original reviewed private draft remains at `/private/tmp/slc-later-phase-gears-triplet`; these source, manifest, and oracle bytes are identical to that draft.

Run the deterministic recorder-selection, source-identity, mutation, and real GEARS-parser checks without a provider:

```bash
npx vitest run test/clarification-gears-corpus.test.mjs
```

After environment validation, the following measures one case and **makes real model calls**:

```bash
node scripts/phase-probe.mjs \
  --compiler-root /path/to/frozen/compiler \
  --pipeline-path /path/to/frozen/pipelines \
  --config /path/to/empty.yaml \
  --manifest docs/performance/clarification-gears-corpus/manifest.json \
  --case gears-001 \
  --agent claude-code --model claude-opus-5 --effort low \
  --timeout-seconds 300 --output /path/to/private/evidence
```

Retain each cold case separately. For an additional same-directory user-rerun check, stop the mutant invocation, restore only its original GEARS source, and repeat the same ordinary SLC command; a fresh restored case does not replace that check. The phase recorder's API outcome and own exit code remain separate from SLC CLI exit `2`. Phase acceptance requires ordinary checks and independent semantic reading; it establishes neither full linking nor runtime correctness or a complete-workflow speed improvement. The [evaluation design](../../clarification-corpus-design.md) governs scoring and failure accounting.
