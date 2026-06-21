<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# FCAP: File Capability

## Intent

This package specifies the host-supplied file capability that `slc` gives a
compiled phase artifact for deterministic, confined file access, per
[DR-008](../decisions/008-slc-file-capability.md).
The capability is an in-process port — not an MCP, command-line, or network
interface — that exposes only whole-file reads, immediate-child directory
listing, and whole-file writes over virtual POSIX paths inside a per-run root,
returning exact-byte `sha256:` hashes.
This package covers the artifact-facing operations and their path, hash, and
write semantics; the host-side grant model that authorizes each operation, and
the mapping of scope failures to the [DR-003](../decisions/003-slc-phase-execution.md)
protocol, are the other concern of this package.

Essential project-specific references: `slc`, this project's compiler; the file
capability and its `FileCapability` contract of
[DR-008](../decisions/008-slc-file-capability.md); the `sha256:` exact-byte hash
of [DR-007](../decisions/007-slc-phase-artifact-pinning.md); and the
[DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) phase-runner facade
that supplies the capability to a compiled artifact.

## Operations

### FCAP-1

The file capability shall expose to a compiled phase artifact only whole-file read, immediate-child directory listing, and whole-file write over virtual POSIX paths, and shall not expose text or line-editing operations, file deletion, host paths, or session state ([DR-008](../decisions/008-slc-file-capability.md#artifact-facing-api)).

## Paths

### FCAP-2

Where a capability operation receives a virtual POSIX path, the file capability shall treat a leading `/` as the run root and normalize the path by collapsing repeated separators and resolving `.` and `..`, and shall reject as `invalid_path` any path that uses platform-absolute syntax such as a Windows drive path or that escapes the run root after normalization or after resolving symlinks ([DR-008](../decisions/008-slc-file-capability.md#paths)).

## Reads

### FCAP-3

When the artifact reads a file, the file capability shall return the file's exact bytes together with their `sha256:` exact-byte hash; for a path that does not exist it shall report `not_found`, and for a directory it shall report `not_file` ([DR-008](../decisions/008-slc-file-capability.md#hashes-and-writes)).

## Listing

### FCAP-4

When the artifact lists a directory, the file capability shall return only its immediate children — each a name and a `file` or `directory` kind — in a stable order with directories before files and names sorted lexicographically within each group, shall not recurse, and shall report `not_directory` for a non-directory path ([DR-008](../decisions/008-slc-file-capability.md#listing)).

## Writes

### FCAP-5

When the artifact writes a file, the file capability shall atomically replace or create the whole target with the exact bytes given, apply no byte transformation, and return the new `sha256:` exact-byte hash ([DR-008](../decisions/008-slc-file-capability.md#hashes-and-writes)).

### FCAP-6

Where a write supplies an `ifMatch` hash, the file capability shall apply the write only when the target's current exact-byte hash equals it, and shall otherwise report `stale` and leave the target unchanged; a fresh write that supplies no `ifMatch` shall not require a prior hash, and of two writes that supply the same `ifMatch` through one capability at most one shall apply ([DR-008](../decisions/008-slc-file-capability.md#hashes-and-writes)).
