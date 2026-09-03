// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import type {
  AgentClient,
  AgentRunRequest,
  AgentRunResult,
} from '../src/interpreter.js';
import { createReviewingAgent } from '../src/reviewing-agent.js';

function queuedClient(results: AgentRunResult[]): AgentClient & {
  calls: AgentRunRequest[];
} {
  const calls: AgentRunRequest[] = [];
  return {
    calls,
    async run(request) {
      calls.push(request);
      const result = results.shift();
      if (result === undefined) throw new Error('unexpected agent call');
      return result;
    },
  };
}

const request = (
  overrides: Partial<AgentRunRequest> = {},
): AgentRunRequest => ({
  prompt: 'produce target.txt from source.txt',
  cwd: '/workspace',
  model: 'coder-model',
  signal: new AbortController().signal,
  ...overrides,
});

const correctionEnvelope = (
  result: string,
  dispositions: Array<{
    finding: number;
    decision: 'accept' | 'reject';
    reason: string;
  }> = [{ finding: 1, decision: 'accept', reason: 'fixed the root cause' }],
): string => JSON.stringify({ dispositions, result });

describe('createReviewingAgent (DR-022)', () => {
  it('returns a clean Coder result after one independent review', async () => {
    const coder = queuedClient([
      { status: 'success', text: 'wrote target', resumeToken: 'coder-1' },
    ]);
    const reviewer = queuedClient([
      { status: 'success', text: 'NO_FINDINGS', resumeToken: 'reviewer-1' },
    ]);
    let reviewerClients = 0;
    const agent = createReviewingAgent({
      coder,
      reviewer: () => {
        reviewerClients++;
        return reviewer;
      },
      reviewerModel: 'review-model',
    });

    await expect(agent.run(request())).resolves.toEqual({
      status: 'success',
      text: 'wrote target',
      resumeToken: 'coder-1',
    });
    expect(reviewerClients).toBe(1);
    expect(reviewer.calls[0]).toMatchObject({
      cwd: '/workspace',
      model: 'review-model',
      resume: false,
    });
    expect(reviewer.calls[0].prompt).toContain('produce target.txt');
    expect(reviewer.calls[0].prompt).toContain('wrote target');
    expect(reviewer.calls[0].prompt).toContain(
      'host-exposed read-only file and search capabilities',
    );
    expect(reviewer.calls[0].prompt).toContain(
      'shell and network capabilities may be unavailable',
    );
    expect(reviewer.calls[0].prompt).toContain(
      'Treat a finding rejected twice with evidence as settled',
    );
    expect(reviewer.calls[0].prompt).toContain(
      'Inspect only the workspace named by the request; do not consult artifacts outside it, including any prior or reference compilation.',
    );
  });

  it('accepts NO_FINDINGS with surrounding whitespace and CRLF', async () => {
    const coder = queuedClient([{ status: 'success', text: 'coder result' }]);
    const reviewer = queuedClient([
      { status: 'success', text: ' \r\n\tNO_FINDINGS\r\n  ' },
    ]);
    const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

    await expect(agent.run(request())).resolves.toEqual({
      status: 'success',
      text: 'coder result',
    });
  });

  it('reads a clean verdict from the end of a reply prefaced by rationale', async () => {
    const coder = queuedClient([{ status: 'success', text: 'coder result' }]);
    const reviewer = queuedClient([
      {
        status: 'success',
        text: 'Verified the fix in detail.\n\nAll assertions reproduce.\n\nNO_FINDINGS',
      },
    ]);
    const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

    await expect(agent.run(request())).resolves.toEqual({
      status: 'success',
      text: 'coder result',
    });
  });

  it('reads a findings block from the end of a reply prefaced by narration', async () => {
    const coder = queuedClient([
      { status: 'success', text: 'initial' },
      {
        status: 'success',
        text: correctionEnvelope('replacement', [
          { finding: 1, decision: 'accept', reason: 'fixed first' },
          { finding: 2, decision: 'reject', reason: 'evidence disproves it' },
        ]),
      },
    ]);
    const reviewer = queuedClient([
      {
        status: 'success',
        text: 'I reviewed the artifact.\n\nFINDINGS:\n1. First finding\n   evidence line\n2. Second finding',
      },
      { status: 'success', text: 'NO_FINDINGS' },
    ]);
    const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

    await expect(agent.run(request())).resolves.toEqual({
      status: 'success',
      text: 'replacement',
    });
    expect(coder.calls[1].prompt).toContain('2. Second finding');
  });

  it('relays findings to the Coder, preserves role resumes, and re-reviews the final Coder text', async () => {
    const signal = new AbortController().signal;
    const coder = queuedClient([
      { status: 'success', text: 'first output', resumeToken: 'coder-1' },
      {
        status: 'success',
        text: correctionEnvelope('replacement result'),
        resumeToken: 'coder-2',
      },
    ]);
    const reviewer = queuedClient([
      {
        status: 'success',
        text: 'FINDINGS:\n1. target omits required data',
        resumeToken: 'reviewer-1',
      },
      { status: 'success', text: 'NO_FINDINGS', resumeToken: 'reviewer-2' },
    ]);
    const agent = createReviewingAgent({
      coder,
      reviewer: () => reviewer,
      reviewerModel: 'review-model',
    });

    const result = await agent.run(
      request({ signal, resume: 'existing-coder-session' }),
    );

    expect(result).toEqual({
      status: 'success',
      text: 'replacement result',
      resumeToken: 'coder-2',
    });
    expect(coder.calls.map((call) => call.resume)).toEqual([
      'existing-coder-session',
      'coder-1',
    ]);
    expect(reviewer.calls.map((call) => call.resume)).toEqual([
      false,
      'reviewer-1',
    ]);
    expect(coder.calls[1]).toMatchObject({
      cwd: '/workspace',
      model: 'coder-model',
      signal,
    });
    expect(coder.calls[1].prompt).toContain('1. target omits required data');
    expect(coder.calls[1].prompt).toContain('Return exactly one JSON object');
    expect(coder.calls[1].prompt).toContain(
      'The original response contract governs only the decoded "result"',
    );
    expect(reviewer.calls[1].prompt).toContain('replacement result');
    expect(reviewer.calls[1].prompt).toContain(
      '--- COMPLETE PRIOR REVIEW TRANSCRIPT ---',
    );
    expect(reviewer.calls[1].prompt).toContain(
      'Reviewer verdict:\nFINDINGS:\n1. target omits required data',
    );
    expect(reviewer.calls[1].prompt).toContain(
      'Coder dispositions:\n1. ACCEPT: fixed the root cause',
    );
    expect(reviewer.calls[1].prompt).toContain(
      'Coder replacement result:\nreplacement result',
    );
    expect(reviewer.calls[1].prompt).not.toContain(
      correctionEnvelope('replacement result'),
    );
    expect(reviewer.calls.every((call) => call.signal === signal)).toBe(true);
    expect(
      reviewer.calls.every((call) =>
        call.prompt.includes('Never edit, write, mutate, or commit'),
      ),
    ).toBe(true);
  });

  it('keeps accepted and rejected dispositions private while preserving a compiled response exactly', async () => {
    const compiledResult = JSON.stringify({
      status: 'ok',
      finalText: 'compiled captain response',
    });
    const privateEnvelope = correctionEnvelope(compiledResult, [
      {
        finding: 1,
        decision: 'accept',
        reason: 'the artifact omitted required behavior',
      },
      {
        finding: 2,
        decision: 'reject',
        reason: 'the cited definition permits this representation',
      },
    ]);
    const coder = queuedClient([
      { status: 'success', text: 'prior compiled response' },
      { status: 'success', text: privateEnvelope },
    ]);
    const reviewer = queuedClient([
      {
        status: 'success',
        text: 'FINDINGS:\n1. missing behavior\n2. questionable representation',
      },
      { status: 'success', text: 'NO_FINDINGS' },
    ]);
    const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

    const result = await agent.run(request());

    expect(result).toEqual({ status: 'success', text: compiledResult });
    expect(result.text).not.toContain('dispositions');
    expect(reviewer.calls[1].prompt).toContain(
      '1. ACCEPT: the artifact omitted required behavior',
    );
    expect(reviewer.calls[1].prompt).toContain(
      '2. REJECT: the cited definition permits this representation',
    );
    expect(reviewer.calls[1].prompt).toContain(
      `Coder replacement result:\n${compiledResult}`,
    );
    expect(reviewer.calls[1].prompt).not.toContain(privateEnvelope);
  });

  it('accepts indented finding evidence while keeping top-level numbering consecutive', async () => {
    const coder = queuedClient([
      { status: 'success', text: 'initial' },
      {
        status: 'success',
        text: correctionEnvelope('replacement', [
          { finding: 1, decision: 'accept', reason: 'fixed first' },
          {
            finding: 2,
            decision: 'reject',
            reason: 'evidence disproves second',
          },
        ]),
      },
    ]);
    const reviewer = queuedClient([
      {
        status: 'success',
        text: 'FINDINGS:\n1. first issue\n   Evidence: line 10\n2. second issue\n\tEvidence: line 20',
      },
      { status: 'success', text: 'NO_FINDINGS' },
    ]);
    const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

    await expect(agent.run(request())).resolves.toEqual({
      status: 'success',
      text: 'replacement',
    });
  });

  it.each([
    ['bare', (json: string) => json],
    ['json fence', (json: string) => `\`\`\`json\n${json}\n\`\`\``],
    ['unlabeled fence', (json: string) => `\`\`\`\n${json}\n\`\`\``],
    [
      'narrated bare',
      (json: string) =>
        `Reading source.txt.\nApplying the accepted repair.\n${json}`,
    ],
    [
      'narrated json fence',
      (json: string) =>
        `Reading source.txt.\nApplying the accepted repair.\n\`\`\`json\n${json}\n\`\`\``,
    ],
    [
      'narration holding an unmatched brace',
      (json: string) => `Restored the "if (ok) {" guard at line 12.\n${json}`,
    ],
  ])('accepts a correction envelope in the %s form', async (_label, wrap) => {
    const coder = queuedClient([
      { status: 'success', text: 'initial' },
      { status: 'success', text: wrap(correctionEnvelope('decoded result')) },
    ]);
    const reviewer = queuedClient([
      { status: 'success', text: 'FINDINGS:\n1. issue' },
      { status: 'success', text: 'NO_FINDINGS' },
    ]);
    const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

    await expect(agent.run(request())).resolves.toEqual({
      status: 'success',
      text: 'decoded result',
    });
  });

  it('decodes a narrated envelope whose result carries braces inside strings', async () => {
    const replacement =
      'target {"nested": "}"} kept verbatim\nplus a \\ backslash and a } brace';
    const coder = queuedClient([
      { status: 'success', text: 'initial' },
      {
        status: 'success',
        text: `Inspecting {the} workspace.\n${correctionEnvelope(replacement)}`,
      },
    ]);
    const reviewer = queuedClient([
      { status: 'success', text: 'FINDINGS:\n1. issue' },
      { status: 'success', text: 'NO_FINDINGS' },
    ]);
    const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

    await expect(agent.run(request())).resolves.toEqual({
      status: 'success',
      text: replacement,
    });
  });

  it.each([
    ['not JSON', 'BLOCKED: raw successful correction'],
    [
      'missing result',
      JSON.stringify({
        dispositions: [
          { finding: 1, decision: 'accept', reason: 'one' },
          { finding: 2, decision: 'reject', reason: 'two' },
        ],
      }),
    ],
    [
      'missing disposition',
      correctionEnvelope('replacement', [
        { finding: 1, decision: 'accept', reason: 'one' },
      ]),
    ],
    [
      'duplicate disposition number',
      correctionEnvelope('replacement', [
        { finding: 1, decision: 'accept', reason: 'one' },
        { finding: 1, decision: 'reject', reason: 'duplicate' },
      ]),
    ],
    [
      'wrong disposition number',
      correctionEnvelope('replacement', [
        { finding: 2, decision: 'accept', reason: 'wrong' },
        { finding: 1, decision: 'reject', reason: 'wrong' },
      ]),
    ],
    [
      'trailing prose after the object',
      `${correctionEnvelope('replacement', [
        { finding: 1, decision: 'accept', reason: 'one' },
        { finding: 2, decision: 'reject', reason: 'two' },
      ])}\nThe envelope is above.`,
    ],
    [
      'two adjacent objects',
      `Applied the repair.\n${correctionEnvelope('replacement', [
        { finding: 1, decision: 'accept', reason: 'one' },
        { finding: 2, decision: 'reject', reason: 'two' },
      ])}\n${correctionEnvelope('other replacement', [
        { finding: 1, decision: 'accept', reason: 'one' },
        { finding: 2, decision: 'reject', reason: 'two' },
      ])}`,
    ],
    [
      'other fence label',
      `\`\`\`typescript\n${correctionEnvelope('replacement', [
        { finding: 1, decision: 'accept', reason: 'one' },
        { finding: 2, decision: 'reject', reason: 'two' },
      ])}\n\`\`\``,
    ],
    [
      'multiple fences',
      `\`\`\`json\n${correctionEnvelope('replacement', [
        { finding: 1, decision: 'accept', reason: 'one' },
        { finding: 2, decision: 'reject', reason: 'two' },
      ])}\n\`\`\`\n\`\`\`json\n{}\n\`\`\``,
    ],
  ])(
    'fails closed on a malformed correction envelope: %s',
    async (_label, correction) => {
      const coder = queuedClient([
        {
          status: 'success',
          text: 'prior usable Coder result',
          resumeToken: 'prior-coder-token',
        },
        {
          status: 'success',
          text: correction,
          resumeToken: 'malformed-correction-token',
        },
      ]);
      const reviewer = queuedClient([
        { status: 'success', text: 'FINDINGS:\n1. first\n2. second' },
      ]);
      const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

      const result = await agent.run(request());

      expect(result.status).toBe('error');
      expect(result.resumeToken).toBe('prior-coder-token');
      expect(result.text).toContain('malformed private review envelope');
      expect(result.text).toContain(
        'latest Coder output: prior usable Coder result',
      );
      expect(result.text).not.toContain(correction);
      expect(reviewer.calls).toHaveLength(1);
    },
  );

  it('bypasses calls carrying an explicit allowedTools property', async () => {
    const coder = queuedClient([{ status: 'success', text: 'routed' }]);
    let reviewerClients = 0;
    const agent = createReviewingAgent({
      coder,
      reviewer: () => {
        reviewerClients++;
        return queuedClient([]);
      },
    });

    await expect(agent.run(request({ allowedTools: [] }))).resolves.toEqual({
      status: 'success',
      text: 'routed',
    });
    expect(reviewerClients).toBe(0);
    expect(coder.calls[0].allowedTools).toEqual([]);
  });

  it.each([
    [{ status: 'error', text: 'coder failed' } as AgentRunResult],
    [{ status: 'incomplete', text: 'coder stopped' } as AgentRunResult],
    [{ status: 'success', text: 'BLOCKED: invalid source' } as AgentRunResult],
  ])(
    'returns a failed or BLOCKED Coder unchanged without review',
    async (result) => {
      const coder = queuedClient([result]);
      let reviewerClients = 0;
      const agent = createReviewingAgent({
        coder,
        reviewer: () => {
          reviewerClients++;
          return queuedClient([]);
        },
      });

      await expect(agent.run(request())).resolves.toEqual(result);
      expect(reviewerClients).toBe(0);
    },
  );

  it.each([
    { status: 'error', text: 'review failed' } as AgentRunResult,
    { status: 'incomplete', text: 'review incomplete' } as AgentRunResult,
    { status: 'success', text: 'looks good' } as AgentRunResult,
    {
      status: 'success',
      text: 'I inspected the artifact.\n\nIt matches the definition well.',
    } as AgentRunResult,
    {
      status: 'success',
      text: 'FINDINGS:\n2. wrong numbering',
    } as AgentRunResult,
    {
      status: 'success',
      text: 'FINDINGS:\n1. real finding\nunrequested epilogue',
    } as AgentRunResult,
  ])(
    'fails closed with a stable diagnostic on repeated Reviewer failure or malformed verdict',
    async (reviewResult) => {
      const coder = queuedClient([
        {
          status: 'success',
          text: 'latest coder report',
          resumeToken: 'coder-1',
        },
      ]);
      // An error result is retried once; every other case fails on the first.
      const reviewer = queuedClient([reviewResult, reviewResult]);
      const agent = createReviewingAgent({
        coder,
        reviewer: () => reviewer,
        reviewRetryDelayMs: 0,
      });

      const result = await agent.run(request());
      expect(result).toMatchObject({
        status: 'error',
        resumeToken: 'coder-1',
      });
      expect(result.text).toContain('review failed closed: Reviewer returned');
      expect(result.text).toContain('latest Coder output: latest coder report');
      expect(result.text).toContain(reviewResult.text);
    },
  );

  it('retries an errored Reviewer call once and continues on its verdict', async () => {
    const coder = queuedClient([
      { status: 'success', text: 'wrote target', resumeToken: 'coder-1' },
    ]);
    const reviewer = queuedClient([
      { status: 'error', text: 'API Error: 529 Overloaded' },
      { status: 'success', text: 'NO_FINDINGS', resumeToken: 'reviewer-1' },
    ]);
    const agent = createReviewingAgent({
      coder,
      reviewer: () => reviewer,
      reviewRetryDelayMs: 0,
    });

    await expect(agent.run(request())).resolves.toEqual({
      status: 'success',
      text: 'wrote target',
      resumeToken: 'coder-1',
    });
    expect(reviewer.calls).toHaveLength(2);
    expect(reviewer.calls[1].prompt).toBe(reviewer.calls[0].prompt);
    expect(reviewer.calls.map((call) => call.resume)).toEqual([false, false]);
    expect(coder.calls).toHaveLength(1);
  });

  it('never retries a stall-aborted Reviewer call', async () => {
    const stall =
      'agent call stalled: no agent activity for 40m; aborted by the stall watchdog';
    const coder = queuedClient([
      {
        status: 'success',
        text: 'latest coder report',
        resumeToken: 'coder-1',
      },
    ]);
    const reviewer = queuedClient([
      { status: 'error', stalled: true, text: stall },
    ]);
    const agent = createReviewingAgent({
      coder,
      reviewer: () => reviewer,
      reviewRetryDelayMs: 0,
    });

    const result = await agent.run(request());

    expect(reviewer.calls).toHaveLength(1);
    expect(result).toMatchObject({ status: 'error', resumeToken: 'coder-1' });
    expect(result.text).toContain(`Reviewer returned error: ${stall}`);
    expect(result.text).toContain('latest Coder output: latest coder report');
  });

  it('fails closed with the second error when the retried Reviewer errors again', async () => {
    const coder = queuedClient([
      {
        status: 'success',
        text: 'latest coder report',
        resumeToken: 'coder-1',
      },
    ]);
    const reviewer = queuedClient([
      { status: 'error', text: 'first overload' },
      { status: 'error', text: 'second overload' },
    ]);
    const agent = createReviewingAgent({
      coder,
      reviewer: () => reviewer,
      reviewRetryDelayMs: 0,
    });

    const result = await agent.run(request());

    expect(reviewer.calls).toHaveLength(2);
    expect(result).toMatchObject({ status: 'error', resumeToken: 'coder-1' });
    expect(result.text).toContain('Reviewer returned error: second overload');
    expect(result.text).not.toContain('first overload');
    expect(result.text).toContain('latest Coder output: latest coder report');
  });

  it('spends no review slot on the retry of an errored Reviewer call', async () => {
    const coder = queuedClient([
      { status: 'success', text: 'initial' },
      { status: 'success', text: correctionEnvelope('correction one') },
      { status: 'success', text: correctionEnvelope('correction two') },
    ]);
    const reviewer = queuedClient([
      { status: 'error', text: 'transient overload' },
      { status: 'success', text: 'FINDINGS:\n1. first issue' },
      { status: 'success', text: 'FINDINGS:\n1. second issue' },
      { status: 'success', text: 'NO_FINDINGS' },
    ]);
    const agent = createReviewingAgent({
      coder,
      reviewer: () => reviewer,
      reviewRetryDelayMs: 0,
    });

    await expect(agent.run(request())).resolves.toEqual({
      status: 'success',
      text: 'correction two',
    });
    expect(reviewer.calls).toHaveLength(4);
    expect(coder.calls).toHaveLength(3);
  });

  it('returns a failing or BLOCKED correction as the latest Coder result without another review', async () => {
    for (const correction of [
      { status: 'error', text: 'fix failed' } as AgentRunResult,
      { status: 'incomplete', text: 'fix incomplete' } as AgentRunResult,
      {
        status: 'success',
        text: correctionEnvelope('BLOCKED: cannot repair'),
      } as AgentRunResult,
    ]) {
      const coder = queuedClient([
        { status: 'success', text: 'first' },
        correction,
      ]);
      const reviewer = queuedClient([
        { status: 'success', text: 'FINDINGS:\n1. material defect' },
      ]);
      const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

      const result = await agent.run(request());
      expect(result.status).toBe(correction.status);
      expect(result.text).toBe(
        correction.status === 'success'
          ? 'BLOCKED: cannot repair'
          : correction.text,
      );
      expect(reviewer.calls).toHaveLength(1);
    }
  });

  it('fails closed when Reviewer construction or execution throws', async () => {
    for (const reviewer of [
      () => {
        throw new Error('adapter unavailable');
      },
      () => ({
        async run() {
          throw new Error('transport crashed');
        },
      }),
    ]) {
      const coder = queuedClient([{ status: 'success', text: 'coder output' }]);
      const agent = createReviewingAgent({ coder, reviewer });
      const result = await agent.run(request());
      expect(result.status).toBe('error');
      expect(result.text).toMatch(/^review failed closed: Reviewer/);
      expect(result.text).toContain('latest Coder output: coder output');
      expect(result.text).toMatch(/adapter unavailable|transport crashed/);
    }
  });

  it('omits correction resume when the immediately preceding Coder or Reviewer token is missing', async () => {
    const coder = queuedClient([
      { status: 'success', text: 'initial without token' },
      {
        status: 'success',
        text: correctionEnvelope('first correction without token'),
      },
    ]);
    const reviewer = queuedClient([
      { status: 'success', text: 'FINDINGS:\n1. repair this' },
      { status: 'success', text: 'NO_FINDINGS' },
    ]);
    const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

    await agent.run(request({ resume: 'original-session' }));

    expect(coder.calls[0].resume).toBe('original-session');
    expect(Object.hasOwn(coder.calls[1], 'resume')).toBe(false);
    expect(reviewer.calls[0].resume).toBe(false);
    expect(Object.hasOwn(reviewer.calls[1], 'resume')).toBe(false);
    expect(reviewer.calls[1].prompt).toContain(
      'Reviewer verdict:\nFINDINGS:\n1. repair this',
    );
    expect(reviewer.calls[1].prompt).toContain(
      'Coder replacement result:\nfirst correction without token',
    );
  });

  it('never reuses older role tokens after a later round omits one', async () => {
    const coder = queuedClient([
      { status: 'success', text: 'initial', resumeToken: 'coder-1' },
      { status: 'success', text: correctionEnvelope('correction one') },
      { status: 'success', text: correctionEnvelope('correction two') },
    ]);
    const reviewer = queuedClient([
      {
        status: 'success',
        text: 'FINDINGS:\n1. first issue',
        resumeToken: 'reviewer-1',
      },
      { status: 'success', text: 'FINDINGS:\n1. second issue' },
      { status: 'success', text: 'NO_FINDINGS' },
    ]);
    const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

    await agent.run(request());

    expect(coder.calls[1].resume).toBe('coder-1');
    expect(Object.hasOwn(coder.calls[2], 'resume')).toBe(false);
    expect(reviewer.calls[1].resume).toBe('reviewer-1');
    expect(Object.hasOwn(reviewer.calls[2], 'resume')).toBe(false);
    expect(coder.calls[2].prompt).toContain(
      '--- COMPLETE PRIOR REVIEW TRANSCRIPT ---',
    );
    expect(coder.calls[2].prompt).toContain(
      'Reviewer verdict:\nFINDINGS:\n1. first issue',
    );
    expect(coder.calls[2].prompt).toContain(
      'Coder replacement result:\ncorrection one',
    );
    expect(reviewer.calls[2].prompt).toContain(
      'Reviewer verdict:\nFINDINGS:\n1. first issue',
    );
    expect(reviewer.calls[2].prompt).toContain(
      'Coder replacement result:\ncorrection one',
    );
    expect(reviewer.calls[2].prompt).toContain(
      'Reviewer verdict:\nFINDINGS:\n1. second issue',
    );
    expect(reviewer.calls[2].prompt).toContain(
      'Coder replacement result:\ncorrection two',
    );
  });

  it('fails closed after three Reviewer findings without a third correction', async () => {
    const finalFindings =
      'FINDINGS:\n1. final unresolved defect at src/output.ts:42';
    const coder = queuedClient([
      { status: 'success', text: 'initial', resumeToken: 'coder-0' },
      {
        status: 'success',
        text: correctionEnvelope('correction one'),
        resumeToken: 'coder-1',
      },
      {
        status: 'success',
        text: correctionEnvelope('correction two'),
        resumeToken: 'coder-2',
      },
    ]);
    const reviewer = queuedClient([
      { status: 'success', text: 'FINDINGS:\n1. first' },
      { status: 'success', text: 'FINDINGS:\n1. second' },
      { status: 'success', text: finalFindings },
    ]);
    const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

    const result = await agent.run(request());

    expect(reviewer.calls).toHaveLength(3);
    expect(coder.calls).toHaveLength(3);
    expect(result.status).toBe('error');
    expect(result.resumeToken).toBe('coder-2');
    expect(result.text).toContain('third and final review call');
    expect(result.text).toContain(
      `unresolved Reviewer findings:\n${finalFindings}`,
    );
    expect(result.text).toContain('latest Coder output: correction two');
  });

  it('relays a mechanical finding in place of that round’s Reviewer call (phase-execution-51)', async () => {
    const coder = queuedClient([
      { status: 'success', text: 'wrote the gears', resumeToken: 'coder-0' },
      {
        status: 'success',
        text: correctionEnvelope('conserved the gears'),
        resumeToken: 'coder-1',
      },
    ]);
    const reviewer = queuedClient([
      { status: 'success', text: 'NO_FINDINGS', resumeToken: 'reviewer-1' },
    ]);
    const rounds = [['CASE-1: prompt line is not an authored fragment'], []];
    const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

    const result = await agent.run(
      request({ mechanicalReview: async () => rounds.shift() ?? [] }),
    );

    expect(coder.calls).toHaveLength(2);
    expect(coder.calls[1].prompt).toContain(
      'FINDINGS:\n1. CASE-1: prompt line is not an authored fragment',
    );
    expect(coder.calls[1].resume).toBe('coder-0');
    // The Reviewer never judged the rejected artifact; it judged the repair.
    expect(reviewer.calls).toHaveLength(1);
    expect(reviewer.calls[0].prompt).toContain(
      'CASE-1: prompt line is not an authored fragment',
    );
    expect(result).toEqual({
      status: 'success',
      text: 'conserved the gears',
      resumeToken: 'coder-1',
    });
  });

  it('spends one permitted Reviewer call per mechanical round and fails closed on the third (phase-execution-51)', async () => {
    const coder = queuedClient([
      { status: 'success', text: 'initial', resumeToken: 'coder-0' },
      {
        status: 'success',
        text: correctionEnvelope('correction one'),
        resumeToken: 'coder-1',
      },
      {
        status: 'success',
        text: correctionEnvelope('correction two'),
        resumeToken: 'coder-2',
      },
    ]);
    const reviewer = queuedClient([]);
    const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

    const result = await agent.run(
      request({
        mechanicalReview: async () => [
          'CASE-2: source instruction fragment at line 7 was dropped or changed',
        ],
      }),
    );

    expect(reviewer.calls).toHaveLength(0);
    expect(coder.calls).toHaveLength(3);
    expect(result.status).toBe('error');
    expect(result.text).toContain('third and final review call');
    expect(result.text).toContain(
      'unresolved Reviewer findings:\nFINDINGS:\n1. CASE-2: source instruction fragment at line 7 was dropped or changed',
    );
    expect(result.text).toContain('latest Coder output: correction two');
  });

  it('fails closed when the mechanical review cannot run (phase-execution-51)', async () => {
    const coder = queuedClient([
      { status: 'success', text: 'wrote the gears' },
    ]);
    const reviewer = queuedClient([]);
    const agent = createReviewingAgent({ coder, reviewer: () => reviewer });

    const result = await agent.run(
      request({
        mechanicalReview: () => {
          throw new Error('unclosed markdown instruction fence at line 4');
        },
      }),
    );

    expect(reviewer.calls).toHaveLength(0);
    expect(result.status).toBe('error');
    expect(result.text).toContain(
      'mechanical review could not run: unclosed markdown instruction fence at line 4',
    );
    expect(result.text).toContain('latest Coder output: wrote the gears');
  });

  it('creates a separate Reviewer conversation for each performing call', async () => {
    const coder = queuedClient([
      { status: 'success', text: 'one' },
      { status: 'success', text: 'two' },
    ]);
    const reviewers = [
      queuedClient([{ status: 'success', text: 'NO_FINDINGS' }]),
      queuedClient([{ status: 'success', text: 'NO_FINDINGS' }]),
    ];
    let next = 0;
    const agent = createReviewingAgent({
      coder,
      reviewer: () => reviewers[next++],
    });

    await agent.run(request({ prompt: 'one' }));
    await agent.run(request({ prompt: 'two' }));

    expect(next).toBe(2);
    expect(reviewers.map((reviewer) => reviewer.calls[0].resume)).toEqual([
      false,
      false,
    ]);
  });
});
