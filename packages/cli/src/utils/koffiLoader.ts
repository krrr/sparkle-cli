/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// koffi is an optional native dependency. It is loaded lazily (and only on
// Windows) so that non-Windows platforms and stripped SEA binaries never pay
// the cost of loading (or failing to load) the native addon. Wrapping the
// import in its own module keeps it easy to mock in tests.
export async function loadKoffi(): Promise<typeof import('koffi')> {
  return import('koffi');
}
