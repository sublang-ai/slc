// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Generic scoped-update planning (INCR-12, INCR-14, INCR-24; DR-021).
 *
 * This module is pure: it parses a definition's frozen `## Update` contract,
 * diffs exact source bytes, and decides whether a step is update-eligible —
 * all before any agent is called. It owns no format-specific rule, no
 * change-ratio threshold, and no generation threshold; scope strings stay
 * opaque. Every uncertainty selects ordinary execution rather than guessing,
 * so a wrong answer costs a re-execution, never a wrong artifact.
 */

import type { StepRecord, UpdateTrace } from './build-record.js';

/** The one frozen declaration line a contract-bearing definition carries. */
const CONTRACT_DECLARATION =
  '{"schema":"sublang.slc.update-contract.v1","traceSchema":"sublang.slc.update.v1"}';

/** The six required `###` subsections, in their required order. */
const CONTRACT_SECTIONS = [
  'Stable input units',
  'Target scopes',
  'Dependency closure',
  'Structural and global scopes',
  'Update instructions',
  'Semantic verification',
] as const;

/**
 * Largest prior×current byte product the exact diff will attempt.
 *
 * The diff is a quadratic dynamic program, so an unbounded pair would try to
 * allocate gigabytes rather than run slowly. The table holds subsequence
 * lengths bounded by the shorter input, so 16-bit cells suffice for any
 * source under 64 KB: this budget is 64M cells, a 128 MB peak, admitting
 * roughly 8 KB against 8 KB. A larger pair selects ordinary execution, which
 * is always correct — just not incremental.
 */
const DIFF_CELL_BUDGET = 64_000_000;

/** One maximal run of non-matching bytes between prior and current input. */
export interface DiffHunk {
  readonly priorStart: number;
  readonly priorEnd: number;
  readonly currentStart: number;
  readonly currentEnd: number;
}

/** Why a step cannot take the scoped-update path. */
export type OrdinaryReason =
  | 'link-step'
  | 'compiled-step'
  | 'no-contract'
  | 'no-trace'
  | 'open-closure'
  | 'identity-drift'
  | 'unbound-trace'
  | 'no-change'
  | 'diff-too-large'
  | 'cross-unit-change'
  | 'ambiguous-insertion'
  | 'structural-or-global-scope'
  | 'incomplete-closure';

export type ScopedUpdatePlan =
  | { readonly mode: 'ordinary'; readonly reason: OrdinaryReason }
  | {
      readonly mode: 'update';
      readonly hunks: readonly DiffHunk[];
      /** Input scopes the change lands in, in input-partition order. */
      readonly dirtyInputScopes: readonly string[];
      /** Their complete target closure, in prior-target partition order. */
      readonly allowedTargetScopes: readonly string[];
    };

/**
 * Reports whether a phase definition carries the frozen update contract.
 *
 * Only the structure is validated: the declaration line is one exact frozen
 * string, and exactly the six required direct `###` subsections follow once
 * each in order, each nonempty, with no other direct subsection before the
 * next `##`. A missing or malformed contract leaves ordinary semantics valid
 * and makes the phase update-ineligible (INCR-12).
 */
export function parseUpdateContract(definition: string): boolean {
  const lines = definition.split(/\r?\n/);
  const headings: number[] = [];
  let fenced = false;
  for (const [index, line] of lines.entries()) {
    if (line.trimStart().startsWith('```')) fenced = !fenced;
    else if (!fenced && /^## Update\s*$/.test(line)) headings.push(index);
  }
  // At most one `## Update` heading; none means no contract.
  if (headings.length !== 1) return false;

  const start = headings[0] + 1;
  let end = lines.length;
  let scanFenced = false;
  for (let index = start; index < lines.length; index++) {
    const line = lines[index];
    if (line.trimStart().startsWith('```')) scanFenced = !scanFenced;
    else if (!scanFenced && /^##\s/.test(line) && !/^###/.test(line)) {
      end = index;
      break;
    }
  }
  const body = lines.slice(start, end);

  // The first three nonblank lines are exactly the fence, the frozen
  // declaration, and the closing fence — no surrounding prose.
  const nonblank = body.filter((line) => line.trim() !== '');
  if (nonblank.length < 3) return false;
  if (nonblank[0].trim() !== '```json') return false;
  if (nonblank[1].trim() !== CONTRACT_DECLARATION) return false;
  if (nonblank[2].trim() !== '```') return false;

  // Exactly the six required direct subsections, once each, in order, each
  // with some content before the next heading.
  const found: { title: string; index: number }[] = [];
  let bodyFenced = false;
  for (const [index, line] of body.entries()) {
    if (line.trimStart().startsWith('```')) bodyFenced = !bodyFenced;
    else if (!bodyFenced && /^### /.test(line)) {
      found.push({ title: line.slice(4).trim(), index });
    }
  }
  if (found.length !== CONTRACT_SECTIONS.length) return false;
  return found.every((section, position) => {
    if (section.title !== CONTRACT_SECTIONS[position]) return false;
    const next = found[position + 1]?.index ?? body.length;
    return body
      .slice(section.index + 1, next)
      .some((line) => line.trim() !== '');
  });
}

/**
 * Computes the exact byte diff as maximal runs of non-matching operations.
 *
 * Adjacent deletions and insertions coalesce into one hunk, so a replacement
 * reports as a single change rather than a delete beside an insert. Returns
 * `null` when the inputs exceed the diff budget, which selects ordinary
 * execution rather than attempting an unbounded allocation.
 */
export function diffBytes(
  prior: Uint8Array,
  current: Uint8Array,
): DiffHunk[] | null {
  if (
    prior.length * current.length > DIFF_CELL_BUDGET ||
    prior.length >= 65_536 ||
    current.length >= 65_536
  ) {
    return null;
  }

  // Longest common subsequence over exact bytes; no text normalization.
  const width = current.length + 1;
  const table = new Uint16Array((prior.length + 1) * width);
  for (let i = prior.length - 1; i >= 0; i--) {
    for (let j = current.length - 1; j >= 0; j--) {
      table[i * width + j] =
        prior[i] === current[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const hunks: DiffHunk[] = [];
  let i = 0;
  let j = 0;
  let open: { priorStart: number; currentStart: number } | null = null;
  const close = (): void => {
    if (open === null) return;
    hunks.push({
      priorStart: open.priorStart,
      priorEnd: i,
      currentStart: open.currentStart,
      currentEnd: j,
    });
    open = null;
  };
  while (i < prior.length && j < current.length) {
    if (prior[i] === current[j]) {
      close();
      i++;
      j++;
    } else {
      open ??= { priorStart: i, currentStart: j };
      // Match before delete before insert keeps the walk deterministic.
      if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
      else j++;
    }
  }
  if (i < prior.length || j < current.length) {
    open ??= { priorStart: i, currentStart: j };
    i = prior.length;
    j = current.length;
  }
  close();
  return hunks;
}

export interface ScopedUpdateInputs {
  readonly step: { readonly kind: StepRecord['kind']; readonly id: string };
  /** The recorded step this run would update from, when one exists. */
  readonly recorded: StepRecord | undefined;
  /** True when the current definition carries the frozen contract. */
  readonly contract: boolean;
  /** True when drift already proved this step must execute ordinarily. */
  readonly identityDirty: boolean;
  readonly currentClosure: StepRecord['inputClosure'];
  readonly priorInput: Uint8Array;
  readonly currentInput: Uint8Array;
}

/**
 * Selects scoped update or ordinary execution for one step, before any agent
 * call. Every gate below fails toward ordinary execution: an unmapped or
 * ambiguous change, a cross-unit edit, a structural or global scope, a
 * broken recorded ordering, or drift the old trace cannot describe (INCR-14).
 */
export function planScopedUpdate(inputs: ScopedUpdateInputs): ScopedUpdatePlan {
  const ordinary = (reason: OrdinaryReason): ScopedUpdatePlan => ({
    mode: 'ordinary',
    reason,
  });

  if (inputs.step.kind === 'link') return ordinary('link-step');
  const recorded = inputs.recorded;
  if (recorded === undefined || recorded.id !== inputs.step.id) {
    return ordinary('identity-drift');
  }
  if (inputs.identityDirty) return ordinary('identity-drift');
  if (
    inputs.currentClosure !== 'closed' ||
    recorded.inputClosure !== 'closed'
  ) {
    return ordinary('open-closure');
  }
  if (!inputs.contract) return ordinary('no-contract');
  const trace = recorded.trace;
  if (trace === null) return ordinary('no-trace');
  // The trace must describe the exact prior bytes in hand, or it cannot be
  // used to map this change.
  if (trace.input.byteLength !== inputs.priorInput.byteLength) {
    return ordinary('unbound-trace');
  }

  const hunks = diffBytes(inputs.priorInput, inputs.currentInput);
  if (hunks === null) return ordinary('diff-too-large');
  if (hunks.length === 0) return ordinary('no-change');

  const dirty: string[] = [];
  for (const hunk of hunks) {
    const scope = mappedScope(trace, hunk);
    if (scope === null) {
      return ordinary(
        hunk.priorEnd === hunk.priorStart
          ? 'ambiguous-insertion'
          : 'cross-unit-change',
      );
    }
    if (scope.classification !== 'local') {
      return ordinary('structural-or-global-scope');
    }
    if (!dirty.includes(scope.scope)) dirty.push(scope.scope);
  }

  // Every dirty unit needs a recorded closure, and the allowed target set is
  // exactly their union — never a caller-chosen subset or superset.
  const allowed: string[] = [];
  for (const name of dirty) {
    const dependency = trace.dependencies.find((entry) => entry.input === name);
    if (dependency === undefined) return ordinary('incomplete-closure');
    for (const targetName of dependency.targets) {
      if (!allowed.includes(targetName)) allowed.push(targetName);
    }
  }
  const order = trace.target.scopes.map((scope) => scope.scope);
  if (allowed.some((name) => !order.includes(name))) {
    return ordinary('incomplete-closure');
  }
  return {
    mode: 'update',
    hunks,
    dirtyInputScopes: dirty.sort(
      (left, right) => scopeIndex(trace, left) - scopeIndex(trace, right),
    ),
    allowedTargetScopes: allowed.sort(
      (left, right) => order.indexOf(left) - order.indexOf(right),
    ),
  };
}

/**
 * Returns the single input scope a hunk lands in, or `null` when it spans
 * more than one unit or sits at a boundary an insertion cannot be attributed
 * to. A boundary insertion is ambiguous by construction, so it fails closed.
 */
function mappedScope(
  trace: UpdateTrace,
  hunk: DiffHunk,
): UpdateTrace['input']['scopes'][number] | null {
  if (hunk.priorEnd > hunk.priorStart) {
    const covering = trace.input.scopes.filter(
      (scope) => hunk.priorStart < scope.end && hunk.priorEnd > scope.start,
    );
    return covering.length === 1 ? covering[0] : null;
  }
  const inside = trace.input.scopes.filter(
    (scope) => hunk.priorStart > scope.start && hunk.priorStart < scope.end,
  );
  return inside.length === 1 ? inside[0] : null;
}

function scopeIndex(trace: UpdateTrace, name: string): number {
  return trace.input.scopes.findIndex((scope) => scope.scope === name);
}

/** Why a returned update candidate was rejected. */
export type CandidateRejection =
  | 'no-replacement-trace'
  | 'input-not-current'
  | 'target-not-candidate'
  | 'scope-outside-closure'
  | 'unchanged-closure-altered'
  | 'input-partition-altered'
  | 'protected-bytes-changed'
  | 'target-partition-altered';

/**
 * Checks a returned candidate against the invariants the request fixed.
 *
 * The replacement trace must bind its input partition to the current operand
 * and its target partition to the complete candidate bytes; every unchanged
 * input scope must retain its exact recorded closure; and each dirty scope's
 * replacement closure may name only allowed target scopes. A rejection is
 * terminal — the staged run is discarded rather than silently retried
 * ordinarily, so a rejected update never hides behind a passing build
 * (INCR-15, INCR-16, INCR-25).
 */
export function acceptUpdateCandidate(opts: {
  readonly priorTrace: UpdateTrace;
  readonly replacement: UpdateTrace | undefined;
  readonly dirtyInputScopes: readonly string[];
  readonly allowedTargetScopes: readonly string[];
  readonly currentInputHash: string;
  readonly currentInputByteLength: number;
  readonly candidateHash: string;
  readonly candidateByteLength: number;
  readonly priorTargetBytes: Uint8Array;
  readonly candidateBytes: Uint8Array;
}): CandidateRejection | null {
  const replacement = opts.replacement;
  if (replacement === undefined) return 'no-replacement-trace';
  if (
    replacement.input.hash !== opts.currentInputHash ||
    replacement.input.byteLength !== opts.currentInputByteLength
  ) {
    return 'input-not-current';
  }
  if (
    replacement.target.hash !== opts.candidateHash ||
    replacement.target.byteLength !== opts.candidateByteLength
  ) {
    return 'target-not-candidate';
  }
  // The input partition must survive intact: a split, merge, drop, reorder,
  // or reclassification would silently redefine what a later update may
  // touch, so the whole candidate is refused instead.
  const priorInputScopes = opts.priorTrace.input.scopes;
  const nextInputScopes = replacement.input.scopes;
  if (
    priorInputScopes.length !== nextInputScopes.length ||
    priorInputScopes.some(
      (scope, index) =>
        nextInputScopes[index].scope !== scope.scope ||
        nextInputScopes[index].classification !== scope.classification,
    )
  ) {
    return 'input-partition-altered';
  }

  const allowed = new Set(opts.allowedTargetScopes);
  const dirty = new Set(opts.dirtyInputScopes);

  // Every target scope outside the allowed closure must be byte-identical,
  // and the protected scopes must keep their relative order. This is the
  // invariant that makes a scoped update scoped: without it a full
  // regeneration passes every other check.
  let previousStart = -1;
  for (const scope of opts.priorTrace.target.scopes) {
    if (allowed.has(scope.scope)) continue;
    const next = replacement.target.scopes.find(
      (candidate) => candidate.scope === scope.scope,
    );
    if (
      next === undefined ||
      next.start <= previousStart ||
      next.end - next.start !== scope.end - scope.start ||
      !sameBytes(
        opts.priorTargetBytes.subarray(scope.start, scope.end),
        opts.candidateBytes.subarray(next.start, next.end),
      )
    ) {
      return 'protected-bytes-changed';
    }
    previousStart = next.start;
  }

  // The candidate may not introduce a target scope the prior partition did
  // not have and the closure does not allow: an unreferenced new scope is
  // arbitrary bytes appended to the artifact, which the loop above — walking
  // only prior scopes — would never see.
  const priorTargetNames = new Set(
    opts.priorTrace.target.scopes.map((scope) => scope.scope),
  );
  if (
    replacement.target.scopes.some(
      (scope) =>
        !priorTargetNames.has(scope.scope) && !allowed.has(scope.scope),
    )
  ) {
    return 'target-partition-altered';
  }
  for (const dependency of replacement.dependencies) {
    if (dirty.has(dependency.input)) {
      if (dependency.targets.some((name) => !allowed.has(name))) {
        return 'scope-outside-closure';
      }
      continue;
    }
    // An unchanged unit keeps exactly the closure the accepted trace recorded.
    const prior = opts.priorTrace.dependencies.find(
      (entry) => entry.input === dependency.input,
    );
    if (
      prior === undefined ||
      prior.targets.length !== dependency.targets.length ||
      prior.targets.some((name, index) => dependency.targets[index] !== name)
    ) {
      return 'unchanged-closure-altered';
    }
  }
  return null;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((byte, index) => right[index] === byte);
}
