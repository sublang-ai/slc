<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Maintained workflow acceptance harness

This directory contains the opt-in CODE and DEV parent-runtime acceptance harness copied from reviewed private controls.
It is provider-free and is not part of `npm test`.
It validates maintained Playbook workflow artifacts only; it does not accept a freshly generated artifact or complete compiler acceptance.

The harness drives public registry entries from a selected maintained Playbook fixture root, constructs the real host/reconciler path, scripts child playbook returns, checks only advertised Judge reply fields, verifies protected before/after hashes, and requires every runtime scenario to use its own nested Git repository.
The child results are scoped fixtures for parent routing and receipt behavior; they do not test remote pull requests or child implementation internals.

Use the installed package root from this repository by default:

```sh
PLAYBOOK_ROOT="$PWD/node_modules/@sublang/playbook"
```

Run the five probe controls:

```sh
PLAYBOOK_ACCEPTANCE_FIXTURE_ROOT="$PLAYBOOK_ROOT" node --test scripts/workflow-acceptance/probe.test.mjs
```

Choose portable output directories from Node's temporary directory:

```sh
CODE_OUT="$(node -e 'const os=require("node:os"), path=require("node:path"); process.stdout.write(path.join(os.tmpdir(), "slc-workflow-acceptance-code"))')"
DEV_OUT="$(node -e 'const os=require("node:os"), path=require("node:path"); process.stdout.write(path.join(os.tmpdir(), "slc-workflow-acceptance-dev"))')"
```

Run the maintained CODE cases:

```sh
node scripts/workflow-acceptance/maintained.mjs "$PLAYBOOK_ROOT" "$CODE_OUT"
```

Run the maintained DEV cases:

```sh
node scripts/workflow-acceptance/maintained-dev.mjs "$PLAYBOOK_ROOT" "$DEV_OUT"
```

The optional fourth argument filters cases by substring, for example:

```sh
CODE_ONE_OUT="$(node -e 'const os=require("node:os"), path=require("node:path"); process.stdout.write(path.join(os.tmpdir(), "slc-workflow-acceptance-code-one"))')"
node scripts/workflow-acceptance/maintained.mjs "$PLAYBOOK_ROOT" "$CODE_ONE_OUT" code-direct
```

A generated artifact can reuse the core runners only through an explicitly reviewed profile and config object.
The caller must supply `{ registry, createHost, assertSnapshot, construct, profile, source, output, protectedPaths }` matching the actual generated public entry and fixture scope.
Do not reuse `maintainedCodeProfile` or `maintainedDevProfile` as defaults for generated artifacts; they encode reviewed maintained-only guard names and result fields.
If a generated artifact advertises different guards, role ids, entry options, child contracts, or question/result ownership, provide a matching profile or report the artifact unsupported.
