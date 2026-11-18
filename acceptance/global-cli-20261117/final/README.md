<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Consolidated global CLI evidence

Read REPORT.md first. The compressed archive preserves original raw files, snapshots, installed-package identities, all current execution receipts and independent reviews/judgments. evidence-index.json records every uncompressed file SHA256 plus the archive identity. No installed SDK trees, portable Node distributions or private auth directories are included. The three frozen project npm tarballs are included; their normal public dependencies remain external.

The archive deduplicates identical content using ordinary tar hardlinks. Treat the extracted directory as read-only evidence. To reproduce a retained check, make a normal independent file copy of a selected archived workspace into a fresh scratch directory, omit node_modules links and old invocation archives, install the recorded compatible candidates, then run the current SLC CLI `playbook flow.md --complete`. Do not execute against the read-only evidence tree itself. Runtime roots and paths are machine-local and are repaired/revalidated by the compiler. Real cold-generation replay additionally requires the user's own authorized Agent login/network/provider quota; do not reuse any secret from a test log.

Exact original commands, native paths, Node versions, environment selection, Source bytes and stage timings are in each receipt and events.jsonl. The controller scripts retain their original task root; substitute a new root when running elsewhere. Current environment delta is not new generation, historical observations are not formal execute, and local/LAN acquisition is not public npmjs/OIDC approval. Formal delivery remains blocked as recorded; no publish or merge occurred.

The separate rc11 directory contains conveniently accessible full-suite/static/packed-consumer raw streams without extracting this archive. Failed historical attempts and narrower review conclusions remain available rather than being overwritten as successes.
