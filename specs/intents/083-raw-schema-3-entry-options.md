<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-083: Raw Schema-3 Entry Options

## Status

Complete.

## Intent

Match generated registry entries to the installed Captain shell's configured-option boundary.

## Deliverables

- [x] Validate the raw schema-3 configured slice without an obsolete envelope.
- [x] Preserve historical schema-1 `Players` construction.
- [x] Verify required options through the actual installed shell and generated entry.

## Tasks

1. Correct the schema-3 entry boundary, clarify its specification, and verify the current and historical host contracts.

## Verification

Ten entry-option tests pass, including real installed-Captain construction with required configured values and unchanged live capabilities, missing-option refusal before construction, and historical Players behavior.
The complete integration checkout passes specification validation, build, lint, formatting, definitions, release, artifact, pin and both demo checks, plus 1,696 tests with two skips.
The installed-package smoke first exposed its obsolete consumer envelope; correcting that call and the corresponding benchmark fixture preserves the production contract, and both affected checks pass.
