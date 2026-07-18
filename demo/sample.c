// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/*
 * Tiny statistics helpers for the slc/playbook demo.
 *
 * Known defect (the demo's bug-fix task): median() ignores element order
 * and even-length arrays, so median of {3, 1, 2} and of {4, 1, 3, 2} are
 * both wrong. Both functions require count > 0.
 */

#include <stddef.h>

double mean(const double values[], size_t count) {
  double sum = 0.0;
  for (size_t i = 0; i < count; i++) {
    sum += values[i];
  }
  return sum / (double)count;
}

double median(const double values[], size_t count) {
  return values[count / 2];
}
