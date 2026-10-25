/**
 * @license
 * Copyright 2026 krrr
 * SPDX-License-Identifier: Apache-2.0
 */

import { useSyncExternalStore } from 'react';

let currentLiveThought: string | null = null;
const listeners = new Set<() => void>();

export function subscribeLiveThought(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLiveThoughtSnapshot(): string | null {
  return currentLiveThought;
}

export function updateLiveThought(text: string | null): void {
  if (currentLiveThought === text) {
    return;
  }
  currentLiveThought = text;
  for (const listener of listeners) {
    listener();
  }
}

export function resetLiveThought(): void {
  updateLiveThought(null);
}

/**
 * Hook to subscribe to the transient live reasoning tail.
 * Only the leaf component that calls this hook will re-render
 * when new reasoning deltas arrive.
 */
export function useLiveThought(): string | null {
  return useSyncExternalStore(subscribeLiveThought, getLiveThoughtSnapshot);
}
