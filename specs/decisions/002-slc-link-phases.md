<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-002: SLC Link Phases

## Status

Accepted

## Context

Some pipelines produce object artifacts that need runtime bindings before they
are executable.
For example, `playbook` links a state machine to a Playbook runtime.

## Decision

### Terms

| Term | Meaning |
| --- | --- |
| Object artifact | Ordinary compile-chain output before runtime bindings. |
| Link phase | Reserved phase that binds object artifact(s) to a link target. |
| Link target | Pipeline-specific module providing runtime bindings. |
| Linked artifact | Final artifact emitted by a link phase. |

### Link Phase

A pipeline may define one reserved link phase as `link.md` directly inside its pipeline directory (per [DR-001 Directory layout](001-slc-pipeline-layout-naming-invocation.md#directory-layout)):

```text
<pipeline-dir>/link.md
```

`link.md` is excluded from ordinary compile-chain inference and from DR-001's
`<source-format>2<target-format>.md` filename rule.

It shall declare:

- `## Formats`: `source` is the object format; `target` is the linked format.
- `## Link Targets`: shall contain a target-form table; may also declare
  required symbols, supported `--link-option` names, and validation rules.

`link.md` may additionally declare `## Pin Inputs` for compiled artifact pinning per [DR-007](007-slc-phase-artifact-pinning.md#semantic-input-closure); that section is optional and does not change link invocation.

The linked format shall use a different format token from every accepted object
format, even when formats share the same file extension.

Object inputs are ordered and use the declared source format unless the link
phase declares additional accepted object formats.
The link phase validates
object count and compatibility.

Link options are for values that vary per invocation without creating a new
target, such as seeds, step limits, log paths, model names, or dry-run flags.
Without options, each variant would need a distinct target.

A link phase may use this shape:

```markdown
## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | fsm | .ts |
| target | run | .ts |

## Link Targets

| Target form | Meaning |
| --- | --- |
| <path>.ts | TypeScript module exporting a compatible runner. |

Required symbols:
- createRunner

Options:

| Name | Meaning |
| --- | --- |
| seed | Random seed. |

Validation:
Reject invocations with anything other than one object.
Reject targets that do not export required symbols.
```

### CLI

```text
slc <pipeline>.link <object>... <target> [-o <linked-target>]
slc <pipeline> <source> --link <target> [-o <linked-target>]
```

`<target>` is defined by the pipeline's `link.md`.

In `.link` invocation, the final positional operand is the link target.
All earlier positional operands are ordered object artifacts.
At least one object operand is required before the target.

```text
slc <pipeline>.link main.fsm.ts helper.fsm.ts runner.ts -o app.run.ts
```

`slc` shall not infer positional roles by extension, file existence, or `--`.

`--link <target>` is required only for full-pipeline invocation because it
selects the terminal link phase.
Full-pipeline invocation without `--link`
stops at the ordinary compile-chain output from DR-001.
Default link targets are not supported; full-pipeline linking always requires
an explicit `--link <target>`.

`--link-option` values are opaque name/value pairs.
They may be appended to either invocation form.
`slc` passes them to the link phase; `link.md` declares
and validates supported names.

### Output Locations

When a link phase runs, the linked artifact is the pipeline output and the
compile-chain exit artifact is an intermediate.

When linking runs in a full-pipeline invocation:

- ordinary compile-chain outputs are intermediates
- the compile-chain exit artifact becomes the object artifact
- the object artifact is written under `<src-dir>/<basename>.<pipeline>/`
- the linked artifact is written to
  `<src-dir>/<basename>.<pipeline>/<basename>.<target-format>.<ext>` unless
  `-o <linked-target>` overrides
- `-o <linked-target>` controls only the linked artifact

For direct `.link` invocation, one object uses DR-001's source-adjacent
directory and basename rules.
Multiple objects require `-o <linked-target>`.

### Playbook Example

For `playbook`, the object artifact is an XState FSM and the linked artifact
is a host-agnostic Playbook runtime.
The runtime contract is owned by Playbook's authored `slc/link.md` source;
CODE's generated `reference/sdlc/code.playbook/code.playbook.ts` is a
reference realization of that contract, not the contract source.

A `playbook` link phase may use `fsm` as source, `playbook` as target, `.ts`
as both extensions, and a link target that supplies the Playbook linker inputs
needed to bind players and strategies.
The link target affects only the linked artifact; it shall not change the
reviewable FSM object artifact.

`slc playbook flows/onboarding.md --link playbook-link.ts` may write
`flows/onboarding.playbook/onboarding.fsm.ts` as the object artifact and
`flows/onboarding.playbook/onboarding.playbook.ts` as the linked artifact.

The reserved `slc` pipeline ([DR-005](005-slc-self-hosting-meta-pipeline.md)) is
the canonical `playbook` link: it consumes Playbook's authored `slc/link.md`,
which declares `## Formats` (`fsm` `.ts` → `playbook` `.ts`) but, being a
Playbook-owned phase definition rather than a per-pipeline link config, carries
no `## Link Targets` table. `slc` resolves the reserved link through
[DR-005](005-slc-self-hosting-meta-pipeline.md)'s reserved-link handling rather
than this section's generic target-form machinery.
The `playbook` domain pipeline shares that Playbook-authored link, so the same
reserved-link handling and `## Link Targets` exception apply to it and not only
to the name `slc` ([DR-009](009-slc-playbook-pipeline-compilation.md)).

## Consequences

- `slc` gets generic linking without pipeline-specific compiler flags.
- Pipelines own link-target semantics behind one CLI shape.
- Linked full-pipeline output can be executable while object artifacts remain
  reviewable intermediates.
- Loaders must treat `link.md` separately from ordinary phases.
