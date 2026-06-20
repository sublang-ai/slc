// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Public entry point for the SubLang Compiler (slc).
 *
 * The `slc` bin orchestrator (`run`, plus `name`/`version`) lives in app.ts; the
 * generic mechanics, execution boundary, interpreted executor, resolver, and
 * configuration are re-exported from their modules.
 */

export * from './app.js';
export * from './artifacts.js';
export * from './cligent-agent.js';
export * from './config.js';
export * from './execution.js';
export * from './interpreter.js';
export * from './invocation.js';
export * from './link.js';
export * from './phase.js';
export * from './pipeline.js';
export * from './resolver.js';
export * from './runner.js';
