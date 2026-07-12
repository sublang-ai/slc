// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Cligent-backed {@link AgentClient} (DR-004).
 *
 * Backs the interpreter's agent transport with Cligent (npm `@sublang/cligent`),
 * draining its event stream into a normalized {@link AgentRunResult}. The host
 * supplies the concrete `AgentAdapter` (e.g. Claude Code, Codex) and any write
 * permissions, keeping agent selection a configuration concern (PHEXEC-13); the
 * DR-003 write-scope sandbox would be configured here via `permissions`. This
 * transport is exercised by integration runs, not unit tests, since it drives a
 * real agent CLI. See specs/dev/phase-execution.md.
 */

import { Cligent } from '@sublang/cligent';
import type {
  AgentAdapter,
  AgentEvent,
  PermissionPolicy,
} from '@sublang/cligent';

import type { AgentClient, AgentRunResult } from './interpreter.js';

/** Wraps a Cligent adapter as an {@link AgentClient} for the interpreter. */
export function createCligentAgent(opts: {
  adapter: AgentAdapter;
  maxTurns?: number;
  permissions?: PermissionPolicy;
}): AgentClient {
  const cligent = new Cligent(opts.adapter, {
    maxTurns: opts.maxTurns,
    permissions: opts.permissions,
  });

  return {
    async run({
      prompt,
      cwd,
      model,
      resume,
      allowedTools,
      signal,
    }): Promise<AgentRunResult> {
      const texts: string[] = [];
      let resultText = '';
      let status: AgentRunResult['status'] = 'incomplete';
      let resumeToken: string | undefined;

      for await (const raw of cligent.run(prompt, {
        abortSignal: signal,
        cwd,
        model,
        ...(resume !== undefined ? { resume } : {}),
        ...(allowedTools !== undefined
          ? { allowedTools: [...allowedTools] }
          : {}),
      })) {
        const event: AgentEvent = raw;
        if (event.type === 'text') {
          texts.push(event.payload.content);
        } else if (event.type === 'error') {
          status = 'error';
          texts.push(event.payload.message);
        } else if (event.type === 'done') {
          status =
            event.payload.status === 'success'
              ? 'success'
              : event.payload.status === 'error'
                ? 'error'
                : 'incomplete';
          if (event.payload.result) resultText = event.payload.result;
          resumeToken = event.payload.resumeToken;
        }
      }

      return {
        status,
        text: (resultText || texts.join('\n')).trim(),
        ...(resumeToken !== undefined ? { resumeToken } : {}),
      };
    },
  };
}
