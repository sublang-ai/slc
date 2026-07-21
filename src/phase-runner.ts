// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * SLC phase-runner facade for compiled `playbook` artifacts (PHEXEC-23,
 * PHEXEC-24; DR-005).
 *
 * A compiled `playbook` artifact default-exports a `PlaybookRuntimeFactory`
 * (`createPlaybookRuntime`). `slc` drives it host-side — `init` with the
 * DR-010 session/legacy compatibility view over a `PlaybookPorts` adapter, one
 * `handleBossInput` turn seeded from the {@link PhaseInput}, then `dispose` —
 * and derives a {@link PhaseResult}
 * (`ok`/`blocked`/`error`) that {@link mapPhaseResult} maps onto the DR-003
 * protocol: `ok` proceeds to the generic checks, `blocked` is the BLOCKED
 * outcome, and `error` stops the pipeline like a failed generic check.
 *
 * The non-interactive driving lives in the compiled executor; this module owns
 * the shared facade types, the static `playbook`-format recognition the
 * pin-currency validator uses, the seeding of a phase request into the
 * runtime's single Boss turn (PHEXEC-29), and the host workspace contract a
 * transformation-performing direct Captain call carries (PHEXEC-34). See
 * specs/dev/phase-execution.md.
 */

import ts from 'typescript';

import type { ExecutorResult } from './execution.js';

/** What a compiled phase is asked to produce: a compile target or a linked artifact (DR-005). */
export type PhaseInput =
  | { kind: 'compile'; source: string; target: string }
  | {
      kind: 'link';
      objects: string[];
      linkTarget: string;
      options: Record<string, string>;
      linked: string;
    };

/** A compiled phase's terminal outcome, with diagnostics drained for every status (DR-005). */
export interface PhaseResult {
  status: 'ok' | 'blocked' | 'error';
  diagnostics: string[];
}

/**
 * Maps a compiled phase's {@link PhaseResult} onto the DR-003 execution-boundary
 * outcome consumed by `runPhase` (PHEXEC-24).
 *
 * The facade result (owned by the DR-005 artifact contract) and the executor
 * result (owned by the DR-003 boundary) are distinct types, so the compiled
 * executor crosses the boundary through this seam rather than casting: `ok`
 * proceeds to the generic checks, `blocked` is the BLOCKED outcome, and `error`
 * stops the pipeline like a failed generic check, with diagnostics surfaced for
 * every status.
 */
export function mapPhaseResult(result: PhaseResult): ExecutorResult {
  return { status: result.status, diagnostics: result.diagnostics };
}

const PLAYBOOK_FACTORY = 'createPlaybookRuntime';

/**
 * Reports whether a compiled artifact's source resolves to the linked `playbook`
 * format: a module exposing a `createPlaybookRuntime` default export (DR-005).
 * This is the static byte-level recognition the pin-currency validator uses; the
 * loader confirms the contract at run time.
 */
export function resolvesToPlaybook(source: string): boolean {
  const file = ts.createSourceFile(
    'artifact.playbook.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics = (
    file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  if (
    diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error)
  ) {
    return false;
  }
  if (!usesErasableTypeScript(file) || defaultExportCount(file) !== 1) {
    return false;
  }
  if (factoryValueBindingCount(file, PLAYBOOK_FACTORY) !== 1) return false;

  const hasFactoryBinding = factoryBindingIsCallable(file, PLAYBOOK_FACTORY);
  for (const statement of file.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === PLAYBOOK_FACTORY &&
      statement.body !== undefined &&
      hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword) &&
      isSynchronousFunction(statement)
    ) {
      return true;
    }
    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ts.isIdentifier(unwrapExpression(statement.expression)) &&
      ((unwrapExpression(statement.expression) as ts.Identifier).text ===
        PLAYBOOK_FACTORY ||
        // `const factory: PlaybookRuntimeFactory<…> = createPlaybookRuntime;
        // export default factory;` — a typed alias of the factory is the
        // factory; linkers use it to state contract conformance in erasable
        // TypeScript.
        aliasesFactory(
          file,
          (unwrapExpression(statement.expression) as ts.Identifier).text,
        )) &&
      hasFactoryBinding
    ) {
      return true;
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause !== undefined
    ) {
      if (
        ts.isNamedExports(statement.exportClause) &&
        statement.exportClause.elements.some(
          (element) =>
            !statement.isTypeOnly &&
            !element.isTypeOnly &&
            element.name.text === 'default' &&
            (element.propertyName?.text ?? element.name.text) ===
              PLAYBOOK_FACTORY,
        ) &&
        statement.moduleSpecifier === undefined &&
        hasFactoryBinding
      ) {
        return true;
      }
    }
  }
  return false;
}

/** True when `name` is a top-level `const <name> = createPlaybookRuntime;`. */
function aliasesFactory(file: ts.SourceFile, name: string): boolean {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if (
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
      hasModifier(statement, ts.SyntaxKind.DeclareKeyword)
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer !== undefined &&
        ts.isIdentifier(unwrapExpression(declaration.initializer)) &&
        (unwrapExpression(declaration.initializer) as ts.Identifier).text ===
          PLAYBOOK_FACTORY
      ) {
        return true;
      }
    }
  }
  return false;
}

function usesErasableTypeScript(file: ts.SourceFile): boolean {
  let erasable = true;
  const visit = (node: ts.Node): void => {
    if (
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      (ts.isExportAssignment(node) && node.isExportEquals) ||
      (ts.isParameter(node) &&
        ts.isParameterPropertyDeclaration(node, node.parent))
    ) {
      erasable = false;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return erasable;
}

function defaultExportCount(file: ts.SourceFile): number {
  let count = 0;
  for (const statement of file.statements) {
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
    ) {
      count++;
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      count++;
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      count += statement.exportClause.elements.filter(
        (element) =>
          !statement.isTypeOnly &&
          !element.isTypeOnly &&
          element.name.text === 'default',
      ).length;
    }
  }
  return count;
}

function factoryValueBindingCount(file: ts.SourceFile, name: string): number {
  let count = 0;
  for (const statement of file.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === name &&
      statement.body !== undefined
    ) {
      count++;
    }
    if (ts.isVariableStatement(statement)) {
      count += statement.declarationList.declarations.filter(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer !== undefined,
      ).length;
    }
  }
  return count;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true
  );
}

function factoryBindingIsCallable(
  file: ts.SourceFile,
  name: string,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  if (seen.has(name)) return false;
  const nextSeen = new Set(seen).add(name);
  for (const statement of file.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === name &&
      statement.body !== undefined &&
      isSynchronousFunction(statement)
    ) {
      return true;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer !== undefined &&
          callableExpression(file, declaration.initializer, nextSeen)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function callableExpression(
  file: ts.SourceFile,
  expression: ts.Expression,
  seen: ReadonlySet<string>,
): boolean {
  const value = unwrapExpression(expression);
  if (
    (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) &&
    isSynchronousFunction(value)
  ) {
    return true;
  }
  if (ts.isIdentifier(value)) {
    return factoryBindingIsCallable(file, value.text, seen);
  }
  // A DR-019 thin module binds the factory to a shared-engine factory call —
  // `createXStatePlaybookRuntime(machine, spec)`. Static recognition accepts
  // the call exactly when its callee is a non-type named import from the
  // shared engine module; the loader confirms the returned factory's
  // callability at run time (DR-017).
  if (ts.isCallExpression(value)) {
    const callee = unwrapExpression(value.expression);
    if (ts.isIdentifier(callee)) {
      return importedFromSharedEngine(file, callee.text);
    }
  }
  return false;
}

const SHARED_ENGINE_MODULE = '@sublang/playbook/xstate-runtime';

/** True when `name` is a non-type named import from the shared engine. */
function importedFromSharedEngine(file: ts.SourceFile, name: string): boolean {
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== SHARED_ENGINE_MODULE
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier !== undefined) continue;
    const bindings = clause.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (!element.isTypeOnly && element.name.text === name) return true;
    }
  }
  return false;
}

function isSynchronousFunction(
  node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction,
): boolean {
  return (
    !hasModifier(node, ts.SyntaxKind.AsyncKeyword) &&
    (!('asteriskToken' in node) || node.asteriskToken === undefined)
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Seeds a phase request into the single non-interactive Boss turn `slc` hands
 * the runtime through `handleBossInput` (PHEXEC-29; DR-005).
 *
 * The settled SLC-to-runtime seeding contract: one Boss turn whose text states
 * the request kind in prose — so any compiled playbook's judge-backed classifier
 * can route it — and carries the full request as a single-line JSON object
 * introduced by `Request: `, with workspace paths already resolved to absolute
 * host paths, so a runtime (or a deterministic fixture) recovers the exact
 * `PhaseInput` without host-specific parsing.
 */
export function seedPhaseTurn(input: PhaseInput): string {
  const directive =
    input.kind === 'compile'
      ? 'Perform this compile phase non-interactively: transform the source into the target artifact, then stop.'
      : 'Perform this link phase non-interactively: link the object artifacts against the link target into the linked artifact, then stop.';
  return `${directive}\nRequest: ${JSON.stringify(input)}`;
}

/**
 * Composes the host workspace contract a transformation-performing direct
 * Captain call carries (PHEXEC-34; DR-005, DR-012).
 *
 * A linked `playbook` artifact composes host-agnostic Captain prompts — the
 * GEARS-derived domain body plus typed runtime evidence — and is forbidden from
 * appending workspace specifics, which only the host owns. Mirroring the
 * interpreted agent contract (PHEXEC-14), the host therefore supplies the
 * request's absolute workspace paths and write-scope rules at its transport
 * boundary, so the acting Captain writes exactly the declared target instead
 * of merely emitting the artifact in its reply. Routing-only Captain calls
 * (explicitly empty `allowedTools`) and hidden judge calls never carry it.
 */
export function composeWorkspaceContract(input: PhaseInput): string {
  const target = input.kind === 'compile' ? input.target : input.linked;
  const inputs =
    input.kind === 'compile'
      ? [`source to read: ${input.source}`]
      : [
          `object artifacts to read, in order: ${input.objects.join(', ')}`,
          `link target module: ${input.linkTarget}`,
          `options: ${formatWorkspaceOptions(input.options)}`,
        ];

  return [
    'Host workspace (SubLang Compiler):',
    'You are performing the work above non-interactively as one compiled phase of the SubLang Compiler (slc), against these workspace files:',
    ...inputs.map((line) => `- ${line}`),
    `- artifact to write: ${target}`,
    '',
    'Workspace contract — you must:',
    `- write only ${target}, creating or overwriting exactly that file; emitting the artifact solely in your reply does not produce it;`,
    '- not edit the sources, the phase or link definition, specs, link targets, object artifacts, or any other file;',
    '- not commit or otherwise touch version control;',
    '- produce a complete artifact, not a sketch or placeholder;',
    '- verify the produced artifact before finishing, then reply with a concise summary of what you produced and any ambiguity you resolved.',
  ].join('\n');
}

function formatWorkspaceOptions(options: Record<string, string>): string {
  const entries = Object.entries(options);
  if (entries.length === 0) return '(none)';
  return entries.map(([name, value]) => `${name}=${value}`).join(', ');
}
