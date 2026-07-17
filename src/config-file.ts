// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Config-file loader for the `slc` bin (DR-006, CLI-20, CLI-21).
 *
 * Discovers and parses the optional YAML config file that supplies the
 * cligent-invocation defaults — `agent`, `model`, `effort`, and `pipelinePath` — which the
 * environment then overrides (DR-006). Discovery reads `slc.config.yaml` in the
 * working directory, then `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml`; an
 * explicit `--config` path disables discovery and is an error when absent, while
 * a discovery miss returns an empty result that falls through to the environment
 * and defaults. The loader validates a flat schema and rejects unknown keys and
 * mistyped values; the supported-agent check stays with `resolveAgentSelection`
 * so the agent set keeps a single source of truth. Relative `pipelinePath`
 * entries are returned verbatim and resolved against the cwd downstream
 * (CLI-6). See specs/dev/cli.md.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { parse } from 'yaml';

/** Config-file basename discovered in the working directory (DR-006). */
export const CONFIG_FILE = 'slc.config.yaml';
/** Config-file path under the user config home (DR-006). */
export const HOME_CONFIG = join('slc', 'config.yaml');

/** Partial cligent-invocation selection loaded from a config file (DR-006). */
export interface FileConfig {
  agent?: string;
  model?: string;
  effort?: string;
  pipelinePath?: string[];
}

/**
 * A loaded config file: the parsed {@link FileConfig} plus the resolved file
 * path, or `path: undefined` on a discovery miss (no file loaded).
 */
export interface LoadedFileConfig {
  path?: string;
  config: FileConfig;
}

/** Injectable IO for {@link loadConfigFile}; all fields default to the process. */
export interface LoadConfigFileOptions {
  cwd?: string;
  /** Explicit `--config <path>`: disables discovery and errors when absent (CLI-20, CLI-21). */
  configPath?: string;
  /** User config home; defaults to `${XDG_CONFIG_HOME:-~/.config}`. Injectable for tests. */
  configHome?: string;
  /** Environment for resolving `XDG_CONFIG_HOME`; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/** Machine-readable reason a config file was rejected (CLI-21). */
export type ConfigFileErrorCode =
  | 'config-not-found'
  | 'config-parse'
  | 'config-invalid';

/** Raised when an explicit `--config` file is missing, malformed, or invalid (CLI-21). */
export class ConfigFileError extends Error {
  readonly code: ConfigFileErrorCode;

  constructor(code: ConfigFileErrorCode, message: string) {
    super(message);
    this.name = 'ConfigFileError';
    this.code = code;
  }
}

/**
 * Loads the slc config file (DR-006, CLI-20, CLI-21).
 *
 * Resolves the file via an explicit `--config` path or cwd/home discovery,
 * parses and validates it, and returns the partial selection plus the resolved
 * path. A discovery miss returns `{ config: {} }` so the caller falls through to
 * the environment and built-in defaults.
 *
 * @throws {ConfigFileError} when an explicit `--config` path is absent
 *   (`config-not-found`), the file is unreadable or malformed YAML
 *   (`config-parse`), or it violates the flat schema (`config-invalid`).
 */
export async function loadConfigFile(
  options: LoadConfigFileOptions = {},
): Promise<LoadedFileConfig> {
  const cwd = options.cwd ?? process.cwd();
  const path = resolveConfigPath(options, cwd);
  if (path === undefined) {
    return { config: {} };
  }
  const config = await readConfigFile(path);
  return { path, config };
}

function resolveConfigPath(
  options: LoadConfigFileOptions,
  cwd: string,
): string | undefined {
  if (options.configPath !== undefined) {
    const explicit = isAbsolute(options.configPath)
      ? options.configPath
      : resolve(cwd, options.configPath);
    if (!existsSync(explicit)) {
      throw new ConfigFileError(
        'config-not-found',
        `--config file not found: ${options.configPath}`,
      );
    }
    return explicit;
  }

  const cwdConfig = resolve(cwd, CONFIG_FILE);
  if (existsSync(cwdConfig)) {
    return cwdConfig;
  }

  const homeConfig = join(configHome(options), HOME_CONFIG);
  if (existsSync(homeConfig)) {
    return homeConfig;
  }

  return undefined;
}

function configHome(options: LoadConfigFileOptions): string {
  if (options.configHome !== undefined) {
    return options.configHome;
  }
  const env = options.env ?? process.env;
  const xdg = (env.XDG_CONFIG_HOME ?? '').trim();
  return xdg !== '' ? xdg : join(homedir(), '.config');
}

async function readConfigFile(path: string): Promise<FileConfig> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    throw new ConfigFileError(
      'config-parse',
      `Failed to read config file ${path}: ${messageOf(error)}`,
    );
  }

  let raw: unknown;
  try {
    raw = parse(source) as unknown;
  } catch (error) {
    throw new ConfigFileError(
      'config-parse',
      `Failed to parse config file ${path}: ${messageOf(error)}`,
    );
  }

  return normalizeFileConfig(raw, path);
}

const ALLOWED_KEYS = new Set(['agent', 'model', 'effort', 'pipelinePath']);

function normalizeFileConfig(value: unknown, path: string): FileConfig {
  if (value === null || value === undefined) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigFileError(
      'config-invalid',
      `Config file ${path} must contain a mapping of keys to values`,
    );
  }

  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new ConfigFileError(
        'config-invalid',
        `Unknown config key "${key}" in ${path}; allowed keys: agent, model, effort, pipelinePath`,
      );
    }
  }

  const config: FileConfig = {};
  if (input.agent !== undefined) {
    config.agent = requireString(input.agent, 'agent', path);
  }
  if (input.model !== undefined) {
    config.model = requireString(input.model, 'model', path);
  }
  if (input.effort !== undefined) {
    config.effort = requireString(input.effort, 'effort', path);
  }
  if (input.pipelinePath !== undefined) {
    config.pipelinePath = requireStringArray(
      input.pipelinePath,
      'pipelinePath',
      path,
    );
  }
  return config;
}

function requireString(value: unknown, key: string, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigFileError(
      'config-invalid',
      `Config key "${key}" in ${path} must be a non-empty string`,
    );
  }
  return value;
}

function requireStringArray(
  value: unknown,
  key: string,
  path: string,
): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigFileError(
      'config-invalid',
      `Config key "${key}" in ${path} must be a sequence of strings`,
    );
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new ConfigFileError(
        'config-invalid',
        `Config key "${key}[${index}]" in ${path} must be a non-empty string`,
      );
    }
    return entry;
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
