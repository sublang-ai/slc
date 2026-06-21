<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# FCAP: File Capability

## Intent

This package specifies integration acceptance tests for the file capability in
the `file-capability` dev package, exercising a capability rooted at a fixture
directory on a real filesystem so the path, hash, listing, and write behaviors
are checked end to end.

Essential project-specific references: `slc`, this project's compiler; and the
file capability of [DR-008](../decisions/008-slc-file-capability.md).

## Paths

### FCAP-7

Verifies: [FCAP-2](../dev/file-capability.md#fcap-2)

Where a capability is rooted at a fixture directory, when the artifact supplies a path that escapes the root through `..`, a symlink whose target is outside the root, or Windows drive syntax, the capability shall report `invalid_path` and access no file outside the root, and a leading-`/`, `./`, or bare path shall resolve to the same in-root file.

## Reads and writes

### FCAP-8

Verifies: [FCAP-3](../dev/file-capability.md#fcap-3), [FCAP-5](../dev/file-capability.md#fcap-5)

Where a capability is rooted at a fixture directory, when the artifact writes bytes to a path and then reads it back, the write and the read shall return the same `sha256:` exact-byte hash of those bytes.

## Listing

### FCAP-9

Verifies: [FCAP-4](../dev/file-capability.md#fcap-4)

Where a fixture directory holds files and subdirectories, when the artifact lists it, the capability shall return only the immediate children with directories before files and lexicographically ordered names, and shall not include nested entries.

## Compare-and-swap

### FCAP-10

Verifies: [FCAP-6](../dev/file-capability.md#fcap-6)

Where a file exists with a known hash, when the artifact writes with an `ifMatch` equal to that hash the write shall succeed and return the new hash, and when it writes with an `ifMatch` that does not match the capability shall report `stale` and leave the file unchanged; and when two writes supply the same prior hash, exactly one shall succeed and the other shall report `stale`.

## Grants

### FCAP-15

Verifies: [FCAP-11](../dev/file-capability.md#fcap-11)

Where a capability is built from a grant set over a fixture directory, when the artifact reads, lists, or writes an in-root path that no grant covers, the capability shall report `unauthorized`.

### FCAP-16

Verifies: [FCAP-12](../dev/file-capability.md#fcap-12)

Where a grant set authorizes writing the run's target, when the artifact writes that target the write shall succeed, and when it writes any other in-root path the capability shall report `unauthorized` and leave that path unchanged.

### FCAP-17

Verifies: [FCAP-13](../dev/file-capability.md#fcap-13)

Where a grant set is closed over a run's source and semantic-input closure, when the artifact reads a granted input the read shall succeed, and when it reads an in-root file outside that closure the capability shall report `unauthorized`.
