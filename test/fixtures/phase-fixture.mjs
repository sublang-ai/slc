// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// A fixture compiled `phase` artifact for the compiled-executor tests. It reaches
// the workspace only through the runner ports (the file capability) and returns a
// terminal status chosen by its source content: "BLOCK" -> blocked, "ERR" ->
// error, otherwise it writes the target and returns ok.

export default function createPhaseRunner() {
  return {
    async run(input, ports) {
      const read = await ports.read(input.source);
      if (!read.ok) {
        return { status: 'error', diagnostics: [`read failed: ${read.code}`] };
      }
      const text = new TextDecoder().decode(read.value.bytes).trim();
      if (text === 'BLOCK') {
        return { status: 'blocked', diagnostics: ['BLOCKED: fixture blocked'] };
      }
      if (text === 'ERR') {
        return { status: 'error', diagnostics: ['fixture error'] };
      }
      const written = await ports.write(
        input.target,
        new TextEncoder().encode(`compiled:${text}`),
      );
      if (!written.ok) {
        return {
          status: 'error',
          diagnostics: [`write failed: ${written.code}`],
        };
      }
      await ports.emitStatus('fixture wrote target');
      return { status: 'ok', diagnostics: ['compiled ok'] };
    },
  };
}
