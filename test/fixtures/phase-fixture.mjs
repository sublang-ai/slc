// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// A fixture compiled `playbook` artifact for the compiled-executor tests. It is
// driven non-interactively: `init` captures the Playbook ports, and one
// `handleBossInput` turn validates the kind-specific seed prose, reads the
// seeded compile source or first link object, and chooses an outcome by content
// — "BLOCK" parks without writing (the executor derives blocked), "ERR" throws
// (error), otherwise it writes the output so the executor derives ok.

import { readFile, writeFile } from 'node:fs/promises';

export default function createPlaybookRuntime() {
  let ports;
  return {
    async init(p) {
      ports = p;
    },
    async handleBossInput({ text }) {
      // The seed carries the request as a single-line JSON object introduced by
      // `Request: ` after prose naming its request kind (phase-execution-29).
      const marker = 'Request: ';
      const lines = text.split('\n');
      const line = lines.find((candidate) => candidate.startsWith(marker));
      const request = JSON.parse(line.slice(marker.length));
      if (!lines[0].includes(`${request.kind} phase non-interactively`)) {
        throw new Error(`fixture seed does not name ${request.kind} execution`);
      }
      const source =
        request.kind === 'compile' ? request.source : request.objects[0];
      const target =
        request.kind === 'compile' ? request.target : request.linked;
      const content = (await readFile(source, 'utf8')).trim();
      if (content === 'BLOCK') {
        await ports.emitStatus('fixture parked');
        return;
      }
      if (content === 'ERR') {
        throw new Error('fixture error');
      }
      await writeFile(target, `compiled:${content}`);
      await ports.emitStatus('fixture wrote target');
    },
    async dispose() {},
  };
}
