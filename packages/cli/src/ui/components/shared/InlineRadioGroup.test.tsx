/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../../test-utils/render.js';
import { act, useState } from 'react';
import {
  InlineRadioGroup,
  type InlineRadioGroupProps,
} from './InlineRadioGroup.js';

type TestOption = 'none' | 'flash-lite' | 'flash' | 'pro';
const OPTIONS: readonly TestOption[] = ['none', 'flash-lite', 'flash', 'pro'];

type HarnessProps = Omit<
  InlineRadioGroupProps<TestOption>,
  'value' | 'onChange'
> & {
  initialValue: TestOption;
  onChange?: (value: TestOption) => void;
};

function Harness({ initialValue, onChange, ...rest }: HarnessProps) {
  const [value, setValue] = useState<TestOption>(initialValue);
  return (
    <InlineRadioGroup
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('InlineRadioGroup', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders label, hint, and options with the selected marker', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <InlineRadioGroup
        label="Model Tier:"
        hint="(hint text)"
        options={[
          { value: 'gemini', label: 'Gemini' },
          { value: 'openai', label: 'OpenAI-compatible' },
        ]}
        value="openai"
        onChange={vi.fn()}
      />,
    );

    const frame = lastFrame() ?? '';
    expect(frame).toContain('Model Tier:');
    expect(frame).toContain('(hint text)');
    expect(frame).toContain('[ ] Gemini');
    expect(frame).toContain('[●] OpenAI-compatible');
    unmount();
  });

  it('cycles forward on right arrow and space when focused', async () => {
    const { stdin, waitUntilReady, unmount } = await renderWithProviders(
      <Harness
        label="Model Tier:"
        options={OPTIONS}
        initialValue="none"
        focus={true}
        onChange={onChange}
      />,
    );
    await waitUntilReady();

    await act(async () => {
      stdin.write('\u001b[C'); // right arrow -> flash-lite
    });
    await waitUntilReady();
    expect(onChange).toHaveBeenLastCalledWith('flash-lite');

    await act(async () => {
      stdin.write(' '); // space -> flash
    });
    await waitUntilReady();
    expect(onChange).toHaveBeenLastCalledWith('flash');

    unmount();
  });

  it('cycles backward on left arrow and wraps around', async () => {
    const { stdin, waitUntilReady, unmount } = await renderWithProviders(
      <Harness
        label="Model Tier:"
        options={OPTIONS}
        initialValue="none"
        focus={true}
        onChange={onChange}
      />,
    );
    await waitUntilReady();

    await act(async () => {
      stdin.write('\u001b[D'); // left arrow from none -> pro (wraps)
    });
    await waitUntilReady();
    expect(onChange).toHaveBeenLastCalledWith('pro');

    unmount();
  });

  it('ignores cycling keys when not focused', async () => {
    const { stdin, waitUntilReady, unmount } = await renderWithProviders(
      <Harness
        label="Model Tier:"
        options={OPTIONS}
        initialValue="none"
        focus={false}
        onChange={onChange}
      />,
    );
    await waitUntilReady();

    await act(async () => {
      stdin.write('\u001b[C');
      stdin.write('\u001b[D');
      stdin.write(' ');
    });
    await waitUntilReady();
    expect(onChange).not.toHaveBeenCalled();

    unmount();
  });

  it('calls onSubmit when Return is pressed while focused', async () => {
    const onSubmit = vi.fn();
    const { stdin, waitUntilReady, unmount } = await renderWithProviders(
      <Harness
        label="Model Tier:"
        options={OPTIONS}
        initialValue="flash"
        focus={true}
        onSubmit={onSubmit}
      />,
    );
    await waitUntilReady();

    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();
    expect(onSubmit).toHaveBeenCalledTimes(1);

    unmount();
  });
});
