// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// A fixture compiled `playbook` artifact for the compiled-executor tests. It is
// driven non-interactively: `init` captures the Playbook ports, and one
// `handleBossInput` turn reads the seeded source path and chooses an outcome by
// content — "BLOCK" parks without writing (the executor derives blocked), "ERR"
// throws (error), otherwise it writes the target so the executor derives ok.

import { readFile, writeFile } from 'node:fs/promises';

export default function createPlaybookRuntime() {
  let ports;
  return {
    async init(p) {
      ports = p;
    },
    async handleBossInput({ text }) {
      const { source, target } = JSON.parse(text);
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
