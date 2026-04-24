<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-002: SLC Link Phases

## Status

Accepted

## Context

Some pipelines produce object artifacts that need runtime bindings before they
are executable. For example, `playbook` links a state machine to a runner.

## Decision

### Terms

| Term | Meaning |
| --- | --- |
| Object artifact | Ordinary compile-chain output before runtime bindings. |
| Link phase | Reserved phase that binds object artifact(s) to a link target. |
| Link target | Pipeline-specific profile or module providing runtime bindings. |
| Linked artifact | Final artifact emitted by a link phase. |

### Link Phase

A pipeline may define one reserved link phase at:

```text
pipelines/<pipeline>/link.md
```

`link.md` is excluded from ordinary compile-chain inference and from DR-001's
`<source-format>2<target-format>.md` filename rule.

It shall declare:

- `## Formats`: `source` is the object format; `target` is the linked format.
- `## Link Inputs`: optional; contains `Object arity: single|multiple` and
  defaults to `single` when omitted.
- `## Link Targets`: shall contain `Default: <target|none>` and a target-form
  table; may also declare required symbols, supported `--link-option` names,
  and validation rules.

The linked format shall use a different format token from every accepted object
format, even when formats share the same file extension.

Multi-object inputs are ordered and use the declared source format unless the
link phase declares additional accepted object formats.

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

## Link Inputs

Object arity: single

## Link Targets

Default: random-log

| Target form | Meaning |
| --- | --- |
| random-log | Built-in logging random walker. |
| <path>.ts | TypeScript module exporting a compatible runner. |

Required symbols:
- Captain

Options:

| Name | Meaning |
| --- | --- |
| seed | Random seed. |

Validation:
Reject targets that do not export required symbols.
```

### CLI

```text
slc <pipeline>.link <object>... --link <target> [-o <linked-target>]
slc <pipeline> <source> --link <target> [-o <linked-target>]
slc <pipeline> <source> --link <target> --link-option <name>=<value>
```

`<target>` is defined by the pipeline's `link.md`.

`--link <target>` stays a flag in the `.link` form so positionals remain
ordered object artifacts:

```text
slc <pipeline>.link main.fsm.ts helper.fsm.ts --link real-runner -o app.run.ts
```

`slc` shall pass object operands in user order. If a link phase accepts only
one object, `slc` shall reject multiple objects. `slc` shall not infer a
positional link target by extension, file existence, or `--`.

`--link-option` values are opaque name/value pairs. `slc` passes them to the
link phase; `link.md` declares and validates supported names.

### Default Linking

If `link.md` declares a default target, `slc <pipeline> <source>` may run the
link phase by default. Without a default target, full-pipeline invocation
without `--link` stops at the ordinary compile-chain output from DR-001.

### Output Locations

When a link phase runs, the linked artifact is the pipeline output and the
compile-chain exit artifact is an intermediate.

When linking runs in a full-pipeline invocation:

- ordinary compile-chain outputs are intermediates
- the compile-chain exit artifact becomes the object artifact
- the object artifact is written under `<source-dir>/.<pipeline>/`
- the linked artifact is written next to the source as
  `<source-dir>/<basename>.<target-format>.<ext>` unless
  `-o <linked-target>` overrides
- `-o <linked-target>` controls only the linked artifact

For direct `.link` invocation, one object uses DR-001 source-dir and basename
rules. Multiple objects require `-o <linked-target>`.

### Playbook Example

For `playbook`, a link target is a runner profile or module providing symbols
such as `Captain`. A `playbook` link phase may use the shape above with `fsm`
as source, `run` as target, `.ts` as both extensions, `Object arity: single`,
default target `random-log`, and target forms `random-log` or `<path>.ts`.

`slc playbook flows/onboarding.md --link random-log` may write
`flows/.playbook/onboarding.fsm.ts` as the object artifact and
`flows/onboarding.run.ts` as the linked artifact.

## Consequences

- `slc` gets generic linking without pipeline-specific compiler flags.
- Pipelines own link-target semantics behind one CLI shape.
- Linked full-pipeline output can be executable while object artifacts remain
  reviewable intermediates.
- Loaders must treat `link.md` separately from ordinary phases.
