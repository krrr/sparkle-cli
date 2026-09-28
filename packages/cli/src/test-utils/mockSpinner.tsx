/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'vitest';

/**
 * Globally mock CliSpinner so it renders a deterministic first frame.
 *
 * The real component animates frames via setInterval/setState, which produces
 * non-deterministic snapshot output and out-of-act(...) state updates in
 * tests. Tests that need the real animation should opt back in with:
 *
 *   vi.mock('./CliSpinner.js', async (importOriginal) =>
 *     importOriginal<typeof import('./CliSpinner.js')>(),
 *   );
 */
export function mockCliSpinner() {
  vi.mock('../ui/components/CliSpinner.js', async (importOriginal) => {
    const { Text } = await import('ink');
    const { spinners } =
      await importOriginal<typeof import('../ui/components/CliSpinner.js')>();

    return {
      CliSpinner: ({ type = 'dots' }: { type?: keyof typeof spinners }) => (
        <Text>{spinners[type].frames[0]}</Text>
      ),
    };
  });
}
