<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-008: SLC File Capability

## Status

Superseded.
`slc` compiled execution no longer uses a host-side file capability or a player sandbox.
A compiled phase writes through the coding agents its runtime drives and relies on the [DR-003](003-slc-phase-execution.md) generic checks for write scope, exactly as interpreted execution does ([DR-004](004-slc-interpreted-phase-execution.md), [DR-005](005-slc-self-hosting-meta-pipeline.md#linked-phase-artifact-contract)).
The `FileCapability` and per-run grant model this record specified, the `FCAP` spec package, and their code are removed.
This record is retained for history; the design below is no longer in force.

## Context

[DR-005](005-slc-self-hosting-meta-pipeline.md) defines the SLC phase-runner facade for compiled phase artifacts and defers the concrete `FileCapability` shape.
A compiled artifact is a Playbook runtime that receives only `PlaybookPorts` through `init`, so the file capability is host-side: `slc`'s compiled executor owns it, and `PhaseInput` carries workspace paths rather than file contents.
The artifact performs no direct file I/O; agentic work reaches the workspace through the coding agents the runtime drives, and `slc` stages deterministic reads and writes around the run.

[DR-003](003-slc-phase-execution.md) requires every executing phase to write only its declared target or linked artifact, and it leaves broader write-scope enforcement to the host through sandboxes, snapshots, or write allowlists.
[DR-007](007-slc-phase-artifact-pinning.md) requires exact-byte hashes, a closed semantic input closure for pinned phases, and fail-closed compiled selection.
The file capability must support those contracts without making the generated artifact responsible for certifying its own inputs or enforcing its own sandbox.

This DR settles only the host-supplied file capability.
It does not define Playbook ports, structured tool ports, process sandboxing, or the implementation of generic checks.

## Decision

### Capability boundary

`FileCapability` is an in-process host port owned by `slc`'s compiled executor, which drives the compiled phase runner.
It is not an MCP interface, command-line interface, or network protocol.
It exposes deterministic file access through a small host-side API and a per-run grant policy.

The host constructs one capability per phase run from:

- the `PhaseInput` paths for the run;
- the pipeline and link metadata already resolved by `slc`;
- the current pin record for a pinned compiled phase, when one applies;
- the host's workspace root and security policy.

The capability is default-deny.
An operation succeeds only when the normalized path is inside the run root, passes realpath containment, and is covered by the host's per-run grant policy.

### Capability API

The host-side `FileCapability` shall expose only whole-file reads, bounded directory listing, and whole-file writes:

```typescript
type SlcPath = string;
type Hash = `sha256:${string}`;

type FileResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: FileErrorCode; diagnostic: string };

type FileErrorCode =
  | 'invalid_path'
  | 'not_found'
  | 'not_file'
  | 'not_directory'
  | 'unauthorized'
  | 'stale'
  | 'io_error';

interface DirectoryEntry {
  name: string;
  kind: 'file' | 'directory';
}

interface FileCapability {
  read(path: SlcPath): Promise<FileResult<{ bytes: Uint8Array; hash: Hash }>>;
  list(path: SlcPath): Promise<FileResult<{ entries: DirectoryEntry[] }>>;
  write(
    path: SlcPath,
    bytes: Uint8Array,
    opts?: { ifMatch?: Hash },
  ): Promise<FileResult<{ hash: Hash }>>;
}
```

The API is byte-oriented.
It shall not expose text-specific operations, line-editing operations, file deletion, host paths, session state, or grant introspection.
If a later DR adds a text convenience, its hash shall still be over exact bytes, not decoded text.

### Paths

All `FileCapability` paths are virtual POSIX paths inside the run root.
A leading `/` is allowed but does not mean an operating-system absolute path.
The host shall normalize paths before authorization and filesystem access by collapsing repeated separators, removing `.`, and resolving `..`.
The host shall reject paths that escape the run root after normalization.
The host shall reject platform-specific absolute path syntax, including Windows drive paths.
The host shall enforce containment after resolving symlinks, so a symlink inside the run root cannot grant access outside it.

### Hashes and writes

Every successful `read` shall return the exact-byte SHA-256 hash of the stored bytes as `sha256:<64 lowercase hex characters>`.
Every successful `write` shall atomically replace or create the whole target file and return the new exact-byte hash.
The capability shall not normalize line endings or otherwise transform bytes for hashing.

The optional `ifMatch` argument is a compare-and-swap guard for phases that intentionally perform read-modify-write against an existing writable artifact.
When `ifMatch` is present and the current file hash differs, `write` shall return a `stale` error and shall not modify the file.
Fresh target writes do not require `ifMatch`.

### Host-side grants

The host shall construct a per-run grant model before invoking a compiled artifact.
The grant model is host-side policy and may be emitted in diagnostics or telemetry for audit, but it is not exposed through the `FileCapability` API.

A grant records:

- a normalized virtual path;
- read or write access;
- file or directory kind;
- for directory grants, whether listing is allowed and whether descendant reads are recursive;
- an optional expected identity: exact-byte hash for files, listing identity for non-recursive directory listing, or subtree identity for recursive directory grants;
- a reason drawn from `source`, `object`, `linkTarget`, `semanticInput`, `target`, or `linked`.

For ordinary compile phases, the only writable path is `PhaseInput.target`.
For link phases, the only writable path is `PhaseInput.linked`.
Any attempted write outside the writable path shall be refused and surfaced as a host failure that maps like a failed generic check, not as a phase-reported `BLOCKED` result.

Read grants shall cover only inputs the run is allowed to consume.
For a pinned compiled phase, read grants are closed over the runtime source, object inputs, runtime link target when applicable, and the declared [DR-007](007-slc-phase-artifact-pinning.md) semantic input closure.
Pinned semantic input grants shall enumerate files unless the pin closure records a directory identity.
A pinned compiled phase shall not receive a directory grant that allows listing unless the directory's listing identity is included in the pin closure.
A pinned compiled phase shall not receive a recursive directory read grant unless the directory's subtree identity is included in the pin closure.
Until a pinning extension defines directory listing and subtree identities, hosts shall not grant directory listing or recursive directory reads for pinned semantic inputs.

### Listing

`list` shall return only immediate children of a granted directory.
It shall not recurse.
Entries shall include the child name and whether it is a file or directory.
The host should return entries in a stable order with directories before files and names sorted lexicographically within each group.

Listing is for deterministic traversal of explicitly granted directories.
For pinned compiled phases, listing a semantic input directory is allowed only when the directory's listing identity is part of the pin closure.
It shall not be used to widen the semantic input closure at runtime.

### Failure mapping

Capability errors are structured so `slc` can map them consistently after the phase runner returns.
An unauthorized read or write, invalid path, symlink escape, or write outside the allowlist is a host-enforced scope failure.
It shall fail like a failed generic check under [DR-003](003-slc-phase-execution.md), because the executing artifact violated the run boundary.

A missing or malformed input may make the compiled phase `blocked` when the phase definition says the input is incompatible.
The host shall not rely on the artifact to perform DR-003 generic checks or DR-007 pin currency checks.
Those checks remain `slc` responsibilities around phase execution.

## Consequences

- Compiled phases get deterministic, host-mediated file access without the artifact performing direct file I/O or seeing host-specific paths.
- The capability port stays small: read bytes, list immediate children, and atomically write bytes.
- Write-scope enforcement is explicit and host-controlled, matching DR-003's target-or-linked invariant.
- Pinned compiled phases cannot silently depend on undeclared files through recursive reads or directory discovery.
- Exact-byte hashes align file access with DR-007 pin currentness and generic input integrity checks.
- Text-editing, deletion, recursive traversal, MCP transport, and structured tool execution remain outside this capability and can be added only by later DRs if needed.
