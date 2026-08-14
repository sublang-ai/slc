// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// A fixture compiled `playbook` artifact for the compiled-executor tests. It is
// driven non-interactively: `init` captures the Playbook ports, and one
// `handleBossInput` turn reads the seeded source path and chooses an outcome by
// content — "BLOCK" parks without writing (the executor derives blocked), "ERR"
// throws (error), otherwise it asks Player to perform the bound write so the
// executor derives ok from the host-owned physical sink.

import { readFile } from 'node:fs/promises';

export default function createPlaybookRuntime() {
  let ports;
  return {
    async init(p) {
      ports = p;
    },
    async handleBossInput({ text, signal }) {
      // The seed carries the request as a single-line JSON object introduced by
      // `Request: ` (PHEXEC-29).
      const marker = 'Request: ';
      const line = text
        .split('\n')
        .find((candidate) => candidate.startsWith(marker));
      const { source, target } = JSON.parse(line.slice(marker.length));
      const content = (await readFile(source, 'utf8')).trim();
      if (content === 'BLOCK') {
        await ports.emitStatus('fixture parked');
        return;
      }
      if (content === 'ERR') {
        throw new Error('fixture error');
      }
      const result = await ports.callPlayer(
        'writer',
        `Write exactly ${JSON.stringify(`compiled:${content}`)} to the bound output sink for ${target}.`,
        signal,
      );
      if (result.status !== 'ok') throw new Error('fixture Player failed');
      await ports.emitStatus('fixture wrote target');
    },
    async dispose() {},
  };
}
