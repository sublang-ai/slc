// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import * as cligent from '@sublang/cligent';

/** Older consumer-supplied Cligent releases may have no independent switch. */
export function ultracodeOptionsFor(
  agent: string,
  value: boolean | undefined,
): { ultracode?: boolean } {
  if (value === undefined) return {};
  if (agent !== 'claude-code' && agent !== 'claude') {
    if (!value) return {};
    throw new Error(`ultracode is not supported by adapter "${agent}"`);
  }
  const support = (
    cligent as unknown as { isUltracodeSupported?: (agent: string) => boolean }
  ).isUltracodeSupported;
  if (typeof support !== 'function') {
    throw new Error(
      'ultracode requires a consumer-supplied @sublang/cligent version exposing isUltracodeSupported; upgrade Cligent',
    );
  }
  if (!support(agent)) {
    if (!value) return {};
    throw new Error(`ultracode is not supported by adapter "${agent}"`);
  }
  return { ultracode: value };
}
