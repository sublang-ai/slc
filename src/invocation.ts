// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * CLI parsing and invocation routing (DR-001, DR-002).
 *
 * Implements PIPE-9 (`slc <pipeline>[.<phase>] <source> [-o <target>]`), PIPE-12
 * (`slc <pipeline>.link <object>... <target>` with positional, not extension- or
 * `--`-inferred, roles), PIPE-13 (`--link` selects the terminal link phase only
 * for full-pipeline runs), and PIPE-14 (opaque `--link-option name=value` pairs).
 * See specs/dev/pipeline.md.
 */

/** An opaque link option passed through to the link phase (PIPE-14). */
export interface LinkOption {
  name: string;
  value: string;
}

/** A parsed `slc` invocation, routed to one of the four run forms. */
export type Invocation =
  | {
      kind: 'full';
      pipeline: string;
      source: string;
      output: string | null;
      optimize: boolean;
      noOptimize: boolean;
      normalize: boolean;
    }
  | {
      kind: 'phase';
      pipeline: string;
      phase: string;
      source: string;
      output: string | null;
    }
  | {
      kind: 'full-link';
      pipeline: string;
      source: string;
      linkTarget: string;
      output: string | null;
      options: LinkOption[];
      optimize: boolean;
      noOptimize: boolean;
      normalize: boolean;
    }
  | {
      kind: 'link';
      pipeline: string;
      objects: string[];
      linkTarget: string;
      output: string | null;
      options: LinkOption[];
    };

/** Machine-readable reason an invocation was refused. */
export type CliErrorCode =
  | 'no-pipeline'
  | 'operands'
  | 'unexpected-link'
  | 'unexpected-link-option'
  | 'unexpected-flag'
  | 'option-value'
  | 'invalid-link-option'
  | 'unknown-option'
  | 'duplicate-option';

/** Raised when argv does not parse to a valid invocation (DR-001, DR-002). */
export class CliError extends Error {
  readonly code: CliErrorCode;

  constructor(code: CliErrorCode, message: string) {
    super(message);
    this.name = 'CliError';
    this.code = code;
  }
}

/**
 * Parses argv (without the node/script prefix) into a routed {@link Invocation}.
 *
 * Options (`-o`, `--link`, `--link-option`) may be interspersed with positionals;
 * positional roles are assigned by position alone (PIPE-12).
 *
 * @throws {CliError} when the grammar is violated.
 */
export function parseInvocation(argv: readonly string[]): Invocation {
  const positionals: string[] = [];
  let output: string | null = null;
  let link: string | null = null;
  let optimize = false;
  let noOptimize = false;
  let normalize = false;
  const options: LinkOption[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-o') {
      if (output !== null)
        throw new CliError('duplicate-option', 'repeated -o');
      output = takeValue(argv, ++i, '-o');
    } else if (arg === '--link') {
      if (link !== null)
        throw new CliError('duplicate-option', 'repeated --link');
      link = takeValue(argv, ++i, '--link');
    } else if (arg === '--link-option') {
      options.push(parseLinkOption(takeValue(argv, ++i, '--link-option')));
    } else if (arg === '-O' || arg === '--optimize') {
      optimize = true;
    } else if (arg === '--no-optimize') {
      noOptimize = true;
    } else if (arg === '--normalize') {
      normalize = true;
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new CliError('unknown-option', `unknown option "${arg}"`);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length === 0) {
    throw new CliError('no-pipeline', 'missing <pipeline> operand');
  }

  const head = positionals[0];
  const dot = head.indexOf('.');
  const pipeline = dot === -1 ? head : head.slice(0, dot);
  const phase = dot === -1 ? null : head.slice(dot + 1);
  if (pipeline.length === 0 || phase === '') {
    throw new CliError('no-pipeline', `invalid pipeline reference "${head}"`);
  }
  const rest = positionals.slice(1);

  if (optimize && noOptimize) {
    throw new CliError(
      'duplicate-option',
      '-O/--optimize conflicts with --no-optimize',
    );
  }
  if (phase !== null && (optimize || noOptimize || normalize)) {
    throw new CliError(
      'unexpected-flag',
      `${optimize ? '-O' : noOptimize ? '--no-optimize' : '--normalize'} is only valid for a full-pipeline invocation`,
    );
  }

  if (phase === 'link') {
    if (link !== null) {
      throw new CliError(
        'unexpected-link',
        '--link is not valid with a .link invocation',
      );
    }
    if (rest.length < 2) {
      throw new CliError(
        'operands',
        '.link requires at least one object and a target',
      );
    }
    return {
      kind: 'link',
      pipeline,
      objects: rest.slice(0, -1),
      linkTarget: rest[rest.length - 1],
      output,
      options,
    };
  }

  if (phase !== null) {
    if (link !== null) {
      throw new CliError(
        'unexpected-link',
        '--link is only valid for a full-pipeline invocation',
      );
    }
    if (options.length > 0) {
      throw new CliError(
        'unexpected-link-option',
        '--link-option requires a link phase',
      );
    }
    requireSingleSource(rest);
    return { kind: 'phase', pipeline, phase, source: rest[0], output };
  }

  requireSingleSource(rest);
  const source = rest[0];
  if (link !== null) {
    return {
      kind: 'full-link',
      pipeline,
      source,
      linkTarget: link,
      output,
      options,
      optimize,
      noOptimize,
      normalize,
    };
  }
  if (options.length > 0) {
    throw new CliError(
      'unexpected-link-option',
      '--link-option requires --link',
    );
  }
  return {
    kind: 'full',
    pipeline,
    source,
    output,
    optimize,
    noOptimize,
    normalize,
  };
}

function takeValue(
  argv: readonly string[],
  index: number,
  flag: string,
): string {
  if (index >= argv.length) {
    throw new CliError('option-value', `missing value for ${flag}`);
  }
  return argv[index];
}

function parseLinkOption(token: string): LinkOption {
  const eq = token.indexOf('=');
  if (eq <= 0) {
    throw new CliError(
      'invalid-link-option',
      `--link-option must be name=value, got "${token}"`,
    );
  }
  return { name: token.slice(0, eq), value: token.slice(eq + 1) };
}

function requireSingleSource(rest: readonly string[]): void {
  if (rest.length !== 1) {
    throw new CliError(
      'operands',
      `expected exactly one <source>, got ${rest.length}`,
    );
  }
}
