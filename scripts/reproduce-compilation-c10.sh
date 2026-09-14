#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
set -euo pipefail

# Reconstruct the C10/v13 compilation evidence from pinned source commits.
# Default mode performs only pinned archive and overlay provenance checks.
# RUN_NPM_INSTALL=1 enables npm ci/build and v13 baseline/full pipeline assembly.

SLC_REPO="${SLC_REPO:-/Users/basicthinker/Projects/SubLang/slc}"
PLAYBOOK_REPO="${PLAYBOOK_REPO:-/Users/basicthinker/Projects/SubLang/playbook}"
SLC_COMMIT="${SLC_COMMIT:-092e242d134e8681109ec390a9c9707476a79b36}"
PLAYBOOK_BUILDER_COMMIT="${PLAYBOOK_BUILDER_COMMIT:-69ed4ab4d94ed0bd218db9e0d375828a67f57cc0}"
IR090_COMMIT="${IR090_COMMIT:-4b51a7edfd2670f6a4cb4f23285a897ae836e612}"
IR090_PARENT="${IR090_PARENT:-3db1d9d707ca6a34ce79c83924fd6bc72809934b}"

if [[ -n "${SLC_REPRO_ROOT:-}" ]]; then
  if [[ -e "$SLC_REPRO_ROOT" ]]; then
    printf 'requested reproduction path already exists: %s\n' "$SLC_REPRO_ROOT" >&2
    exit 1
  fi
  mkdir -p "$SLC_REPRO_ROOT"
else
  SLC_REPRO_ROOT="$(mktemp -d /private/tmp/slc-c10-v13-reproduction-work.XXXXXX)"
fi

expect_sha() {
  local path="$1"
  local expected="$2"
  local actual
  actual="$(shasum -a 256 "$path" | awk '{print $1}')"
  if [[ "$actual" != "$expected" ]]; then
    printf 'sha mismatch: %s\nexpected %s\nactual   %s\n' "$path" "$expected" "$actual" >&2
    exit 1
  fi
}

expect_git_commit() {
  local repo="$1"
  local commit="$2"
  git -C "$repo" rev-parse --verify "${commit}^{commit}" >/dev/null
}

expect_absent() {
  local path="$1"
  if [[ -e "$path" ]]; then
    printf 'output path already exists: %s\n' "$path" >&2
    exit 1
  fi
}

write_identity_json() {
  cat > "$SLC_REPRO_ROOT/expected-identities.json" <<JSON
{
  "schema": "sublang.slc.c10-v13-reproduction.expected-identities.v1",
  "slcCommit": "$SLC_COMMIT",
  "playbookBuilderCommit": "$PLAYBOOK_BUILDER_COMMIT",
  "ir090RuntimeOverlay": {
    "commit": "$IR090_COMMIT",
    "parent": "$IR090_PARENT",
    "patchSha256": "91a1059e34ec59495d0f435a4200602512b891bb651376f2145434e40d3e92a9",
    "files": {
      "src/xstate-playbook-runtime.ts": {
        "stockSha256": "c24b37ab859c5d2bdfe01b9aa8e5973f32ef5f7c87f6b9fd05349337c36a1ee9",
        "patchedSha256": "7c856c0f45608464f764c3a229c8e55ad1937f5171f5d48947909e5544220d48"
      },
      "src/xstate-playbook-runtime.js": {
        "stockSha256": "e3137c9b7be363c410d143e1e85524bbaf3626fb7eb0b9b0f8c11e7c1c859b5b",
        "patchedSha256": "de4480b705833fa764e4724b25a4932f72616adda74e55934aa29bd39cbc79f5"
      }
    }
  },
  "slcPackage": {
    "packageJsonSha256": "c9b39b529b5a257f3a581135dadefed03cd15ddb559da9bb6a6d66b1c36dafe1",
    "packageLockSha256": "53f91c2b006475257e7138424a03f5d6cd53b102cb195c3e06fd5832153bbee5"
  },
  "v13Pipelines": {
    "historicalBaselineProofSha256Reference": "f6a72e2e613c21360376330bd0789c23e9f59058c69d57d60595b99a3fa70af4",
    "baselineText2gearsSha256": "2500c1ad4601f7a32bb8d44e7ec1e32d15df7875d4972acfcd6d273358d84b0f",
    "baselineGears2fsmSha256": "cdc673f6a8e7596e31995a9ead125384ce68aaebb0e0934d8cb1c532c2be9a86",
    "baselineLinkSha256": "9982d987e9747177876ac7cbac3628fce2afa6e6fec6012c1371b30a712fdad4",
    "historicalFullProofSha256Reference": "41d66e2014237d23a06e509193e4d8c9c964f94b62bb0d4a49f202ad6bd81eca",
    "fullText2gearsSha256": "2500c1ad4601f7a32bb8d44e7ec1e32d15df7875d4972acfcd6d273358d84b0f",
    "fullGears2fsmSha256": "cdc673f6a8e7596e31995a9ead125384ce68aaebb0e0934d8cb1c532c2be9a86",
    "fullLinkSha256": "680b0d2af76bf629c7f7c7417d27aa08205a5cde2ba2eb924389a2df0435642e",
    "preferMaterializerPrivateProofSha256": "7930b4913731f4d525e7dc672bbd7c6a3af977d748566779ed7c55f60d8c8dff",
    "preferMaterializerLinkSha256": "680b0d2af76bf629c7f7c7417d27aa08205a5cde2ba2eb924389a2df0435642e"
  }
}
JSON
}

expect_git_commit "$SLC_REPO" "$SLC_COMMIT"
expect_git_commit "$PLAYBOOK_REPO" "$PLAYBOOK_BUILDER_COMMIT"
expect_git_commit "$PLAYBOOK_REPO" "$IR090_COMMIT"
expect_git_commit "$PLAYBOOK_REPO" "$IR090_PARENT"

SLC_WORK="$SLC_REPRO_ROOT/slc"
PLAYBOOK_WORK="$SLC_REPRO_ROOT/playbook-complex-performance"
expect_absent "$SLC_WORK"
expect_absent "$PLAYBOOK_WORK"
mkdir -p "$SLC_WORK" "$PLAYBOOK_WORK"

git -C "$SLC_REPO" archive "$SLC_COMMIT" | tar -x -C "$SLC_WORK"
git -C "$PLAYBOOK_REPO" archive "$PLAYBOOK_BUILDER_COMMIT" | tar -x -C "$PLAYBOOK_WORK"
expect_sha "$SLC_WORK/package.json" c9b39b529b5a257f3a581135dadefed03cd15ddb559da9bb6a6d66b1c36dafe1
expect_sha "$SLC_WORK/package-lock.json" 53f91c2b006475257e7138424a03f5d6cd53b102cb195c3e06fd5832153bbee5
expect_sha "$PLAYBOOK_WORK/scripts/build-link-experiment-13.2.mjs" 95c0f04c22d47c74f59fc4885942116a4e0d23b4dd2474094356114b767a9db3

OVERLAY_DIR="$SLC_REPRO_ROOT/ir090-runtime-overlay"
expect_absent "$OVERLAY_DIR"
mkdir -p "$OVERLAY_DIR/src" "$OVERLAY_DIR/patch"
git -C "$PLAYBOOK_REPO" show "$IR090_PARENT:src/xstate-playbook-runtime.ts" > "$OVERLAY_DIR/src/xstate-playbook-runtime.parent.ts"
git -C "$PLAYBOOK_REPO" show "$IR090_PARENT:src/xstate-playbook-runtime.js" > "$OVERLAY_DIR/src/xstate-playbook-runtime.parent.js"
git -C "$PLAYBOOK_REPO" show "$IR090_COMMIT:src/xstate-playbook-runtime.ts" > "$OVERLAY_DIR/src/xstate-playbook-runtime.ts"
git -C "$PLAYBOOK_REPO" show "$IR090_COMMIT:src/xstate-playbook-runtime.js" > "$OVERLAY_DIR/src/xstate-playbook-runtime.js"
git -C "$PLAYBOOK_REPO" diff "$IR090_PARENT" "$IR090_COMMIT" -- src/xstate-playbook-runtime.ts src/xstate-playbook-runtime.js > "$OVERLAY_DIR/patch/ir090-runtime-overlay.diff"
expect_sha "$OVERLAY_DIR/src/xstate-playbook-runtime.parent.ts" c24b37ab859c5d2bdfe01b9aa8e5973f32ef5f7c87f6b9fd05349337c36a1ee9
expect_sha "$OVERLAY_DIR/src/xstate-playbook-runtime.parent.js" e3137c9b7be363c410d143e1e85524bbaf3626fb7eb0b9b0f8c11e7c1c859b5b
expect_sha "$OVERLAY_DIR/src/xstate-playbook-runtime.ts" 7c856c0f45608464f764c3a229c8e55ad1937f5171f5d48947909e5544220d48
expect_sha "$OVERLAY_DIR/src/xstate-playbook-runtime.js" de4480b705833fa764e4724b25a4932f72616adda74e55934aa29bd39cbc79f5
expect_sha "$OVERLAY_DIR/patch/ir090-runtime-overlay.diff" 91a1059e34ec59495d0f435a4200602512b891bb651376f2145434e40d3e92a9

if [[ "${RUN_NPM_INSTALL:-0}" == "1" ]]; then
  npm --prefix "$SLC_WORK" ci --ignore-scripts --no-audit --no-fund
  npm --prefix "$SLC_WORK" run build
  mkdir -p "$SLC_WORK/dist"
  cp "$SLC_WORK/src/normalize.md" "$SLC_WORK/src/slc.config.template.yaml" "$SLC_WORK/dist/"

  expect_sha "$SLC_WORK/node_modules/@sublang/playbook/src/xstate-playbook-runtime.ts" c24b37ab859c5d2bdfe01b9aa8e5973f32ef5f7c87f6b9fd05349337c36a1ee9
  expect_sha "$SLC_WORK/node_modules/@sublang/playbook/src/xstate-playbook-runtime.js" e3137c9b7be363c410d143e1e85524bbaf3626fb7eb0b9b0f8c11e7c1c859b5b
  cp "$OVERLAY_DIR/src/xstate-playbook-runtime.ts" "$SLC_WORK/node_modules/@sublang/playbook/src/xstate-playbook-runtime.ts"
  cp "$OVERLAY_DIR/src/xstate-playbook-runtime.js" "$SLC_WORK/node_modules/@sublang/playbook/src/xstate-playbook-runtime.js"
  expect_sha "$SLC_WORK/node_modules/@sublang/playbook/src/xstate-playbook-runtime.ts" 7c856c0f45608464f764c3a229c8e55ad1937f5171f5d48947909e5544220d48
  expect_sha "$SLC_WORK/node_modules/@sublang/playbook/src/xstate-playbook-runtime.js" de4480b705833fa764e4724b25a4932f72616adda74e55934aa29bd39cbc79f5

  BASELINE_ROOT="$SLC_REPRO_ROOT/playbook-13.2-common-v13-baseline"
  FULL_ROOT="$SLC_REPRO_ROOT/playbook-13.2-common-v13-full"
  expect_absent "$BASELINE_ROOT"
  expect_absent "$FULL_ROOT"
  node "$PLAYBOOK_WORK/scripts/build-link-experiment-13.2.mjs" "$SLC_WORK" "$BASELINE_ROOT" --baseline >/dev/null
  node "$PLAYBOOK_WORK/scripts/build-link-experiment-13.2.mjs" "$SLC_WORK" "$FULL_ROOT" --full >/dev/null
  expect_sha "$BASELINE_ROOT/playbook/text2gears.md" 2500c1ad4601f7a32bb8d44e7ec1e32d15df7875d4972acfcd6d273358d84b0f
  expect_sha "$BASELINE_ROOT/playbook/gears2fsm.md" cdc673f6a8e7596e31995a9ead125384ce68aaebb0e0934d8cb1c532c2be9a86
  expect_sha "$BASELINE_ROOT/playbook/link.md" 9982d987e9747177876ac7cbac3628fce2afa6e6fec6012c1371b30a712fdad4
  expect_sha "$FULL_ROOT/playbook/text2gears.md" 2500c1ad4601f7a32bb8d44e7ec1e32d15df7875d4972acfcd6d273358d84b0f
  expect_sha "$FULL_ROOT/playbook/gears2fsm.md" cdc673f6a8e7596e31995a9ead125384ce68aaebb0e0934d8cb1c532c2be9a86
  expect_sha "$FULL_ROOT/playbook/link.md" 680b0d2af76bf629c7f7c7417d27aa08205a5cde2ba2eb924389a2df0435642e
  node - "$BASELINE_ROOT/experiment-proof.json" baseline <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [proofPath, mode] = process.argv.slice(2);
const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
assertEqual(proof.schema, 'sublang.playbook.link-experiment.v1', 'schema');
assertEqual(proof.version, '13.2.0', 'version');
assertEqual(proof.mode, mode, 'mode');
assertEqual(proof.publishedHashes['text2gears.md'], '48a6a5d3f02a1d90dcc0883170da74e16c29b1554533913eb4fd7cefc49251bb', 'published text2gears');
assertEqual(proof.publishedHashes['gears2fsm.md'], 'c549458f39337b4ce1697e1103ee2010656ced0b8a08b2fe57a103f9186c2b1e', 'published gears2fsm');
assertEqual(proof.publishedHashes['link.md'], '294f41c6ebeeb970fb53d2b801e2769dbff3c18a5910b7569c5b547b3daaea5d', 'published link');
assertEqual(proof.commonHashes.text2gears, '2500c1ad4601f7a32bb8d44e7ec1e32d15df7875d4972acfcd6d273358d84b0f', 'common text2gears');
assertEqual(proof.commonHashes.producer, 'cdc673f6a8e7596e31995a9ead125384ce68aaebb0e0934d8cb1c532c2be9a86', 'common producer');
assertEqual(proof.commonHashes.link, '9982d987e9747177876ac7cbac3628fce2afa6e6fec6012c1371b30a712fdad4', 'common baseline link');
assertEqual(proof.optionSnapshotLinkCorrection.currentSha256, 'acad9ed78e56418e98cffc862c74531926925ae83a66bcb3acf6c4472af4dc59', 'option correction');
assertEqual(proof.entryGuardGuidanceCorrection.producerGuidanceSha256, '59c7868b4fe9f47d42c2bc346362f3cd82bb14185695d4ce9388b68ec9ef9d15', 'entry producer correction');
assertEqual(proof.entryGuardGuidanceCorrection.linkGuidanceSha256, '02cf266f099f456bc1333b54bc6420ad6a647b4f3d9a986ed43263d82c88ca9f', 'entry link correction');
assertEqual(proof.outputFieldGuidanceCorrection.guidanceSha256, '0672c82aa5ed47f9381c9e6760c9024638f57d399464f5aeb91def176714de8e', 'output field correction');
const freshProofSha256 = crypto.createHash('sha256').update(fs.readFileSync(proofPath)).digest('hex');
console.log(JSON.stringify({ mode, freshProofSha256 }));
NODE
  node - "$FULL_ROOT/experiment-proof.json" full <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [proofPath, mode] = process.argv.slice(2);
const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}
assertEqual(proof.schema, 'sublang.playbook.link-experiment.v1', 'schema');
assertEqual(proof.version, '13.2.0', 'version');
assertEqual(proof.mode, mode, 'mode');
assertEqual(proof.publishedHashes['text2gears.md'], '48a6a5d3f02a1d90dcc0883170da74e16c29b1554533913eb4fd7cefc49251bb', 'published text2gears');
assertEqual(proof.publishedHashes['gears2fsm.md'], 'c549458f39337b4ce1697e1103ee2010656ced0b8a08b2fe57a103f9186c2b1e', 'published gears2fsm');
assertEqual(proof.publishedHashes['link.md'], '294f41c6ebeeb970fb53d2b801e2769dbff3c18a5910b7569c5b547b3daaea5d', 'published link');
assertEqual(proof.commonHashes.text2gears, '2500c1ad4601f7a32bb8d44e7ec1e32d15df7875d4972acfcd6d273358d84b0f', 'common text2gears');
assertEqual(proof.commonHashes.producer, 'cdc673f6a8e7596e31995a9ead125384ce68aaebb0e0934d8cb1c532c2be9a86', 'common producer');
assertEqual(proof.commonHashes.link, '9982d987e9747177876ac7cbac3628fce2afa6e6fec6012c1371b30a712fdad4', 'common baseline link');
assertEqual(proof.optionSnapshotLinkCorrection.currentSha256, 'acad9ed78e56418e98cffc862c74531926925ae83a66bcb3acf6c4472af4dc59', 'option correction');
assertEqual(proof.entryGuardGuidanceCorrection.producerGuidanceSha256, '59c7868b4fe9f47d42c2bc346362f3cd82bb14185695d4ce9388b68ec9ef9d15', 'entry producer correction');
assertEqual(proof.entryGuardGuidanceCorrection.linkGuidanceSha256, '02cf266f099f456bc1333b54bc6420ad6a647b4f3d9a986ed43263d82c88ca9f', 'entry link correction');
assertEqual(proof.outputFieldGuidanceCorrection.guidanceSha256, '0672c82aa5ed47f9381c9e6760c9024638f57d399464f5aeb91def176714de8e', 'output field correction');
const freshProofSha256 = crypto.createHash('sha256').update(fs.readFileSync(proofPath)).digest('hex');
console.log(JSON.stringify({ mode, freshProofSha256 }));
NODE
fi

write_identity_json
printf 'prepared reproduction root %s\n' "$SLC_REPRO_ROOT"
