<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-055: Literal Relay First Difference

## Status

Complete.

## Intent

Make literal prompt-relay diagnostics identify the first rendered mismatch without changing prompt-composition acceptance, empty-value policy, workflow acceptance, or repair behavior.

## Deliverables

- [x] Bounded first-difference detail on literal and quoted-relay rendering mismatches.
- [x] CRLF-normalizing regression coverage in the link gate and emitted prompt suite.
- [x] Verification spec update for escaped first-difference evidence.
- [x] Retrospective evidence for the preserved `compile-uh9JIL` prompt-composition failure.

## Tasks

1. Add bounded first-difference diagnostics and focused regression coverage for CRLF separator drift.

## Verification

- `npm run build` passed after the verifier diagnostic change; log `/private/tmp/slc-ir055-build.log`.
- `node node_modules/vitest/vitest.mjs run test/link-fidelity.test.ts test/verify.test.ts` passed 202 scoped tests, including faithful, unquoted, and CRLF-normalizing prompt-composer fixtures and same-Coder repair-channel relay of the escaped CRLF detail; log `/private/tmp/slc-ir055-scoped-vitest-final.log`.
- `spex lint` passed; log `/private/tmp/slc-ir055-spex-lint.log`.
- The preserved `compile-uh9JIL` retrospective artifact check still fails only the prompt contract and now reports the first differing UTF-16 offset with bounded JSON-escaped excerpts; log `/private/tmp/slc-ir055-uh9JIL-retro-verify.log`.
- Compact evidence `/private/tmp/slc-ir055-evidence.json` has SHA-256 `e75e5245369282d573b835a91d706c5409af155fe5f9db445e600788d240e5e1`.

- Root full integration/system suite passed 1,404 tests with two expected skips across 75 files using four workers; `/private/tmp/slc-ir055-full-test-four-workers.log`.
- Scoped ESLint and Prettier checks passed without configuration changes.
