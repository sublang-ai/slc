// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { isUltracodeSupported } from '@sublang/cligent';

export function ultracodeOptionsFor(
  agent: string,
  value: boolean | undefined,
): { ultracode?: boolean } {
  if (value === undefined) return {};
  if (isUltracodeSupported(agent)) return { ultracode: value };
  if (!value) return {};
  throw new Error(`ultracode is not supported by adapter "${agent}"`);
}
