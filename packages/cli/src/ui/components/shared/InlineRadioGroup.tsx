/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';
import { useKeypress, type Key } from '../../hooks/useKeypress.js';
import { Command } from '../../key/keyMatchers.js';
import { useKeyMatchers } from '../../hooks/useKeyMatchers.js';

export interface InlineRadioOption<T extends string> {
  value: T;
  /** Display label; defaults to the value itself. */
  label?: string;
}

export interface InlineRadioGroupProps<T extends string> {
  /** Field label shown above the options. */
  label: string;
  /** Optional secondary hint rendered after the label. */
  hint?: string;
  /** Selectable values, either plain strings or { value, label } objects. */
  options: ReadonlyArray<T | InlineRadioOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Whether the group has keyboard focus. */
  focus?: boolean;
  /** Called when Return is pressed while focused. */
  onSubmit?: () => void;
}

function toOption<T extends string>(
  option: T | InlineRadioOption<T>,
): InlineRadioOption<T> & { label: string } {
  return typeof option === 'string'
    ? { value: option, label: option }
    : { value: option.value, label: option.label ?? option.value };
}

/**
 * A single-line radio group: all options rendered in one row as
 * [●] selected / [ ] unselected. When focused, ←/→/space cycle through
 * the options and Return triggers onSubmit. Field navigation between
 * this group and other controls (Tab/↑/↓/Esc) stays with the parent.
 */
export function InlineRadioGroup<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  focus = false,
  onSubmit,
}: InlineRadioGroupProps<T>): React.JSX.Element {
  const keyMatchers = useKeyMatchers();
  const normalizedOptions = options.map(toOption);

  const cycle = useCallback(
    (forward: boolean) => {
      const count = normalizedOptions.length;
      if (count === 0) {
        return;
      }
      const idx = normalizedOptions.findIndex(
        (option) => option.value === value,
      );
      const current = idx === -1 ? 0 : idx;
      onChange(
        normalizedOptions[(current + (forward ? 1 : -1) + count) % count].value,
      );
    },
    [normalizedOptions, value, onChange],
  );

  useKeypress(
    (key: Key) => {
      if (key.name === 'left') {
        cycle(false);
        return true;
      }
      if (key.name === 'right' || key.name === 'space') {
        cycle(true);
        return true;
      }
      if (onSubmit && keyMatchers[Command.RETURN](key)) {
        onSubmit();
        return true;
      }
      return false;
    },
    { isActive: focus },
  );

  return (
    <Box marginTop={1} flexDirection="column">
      <Text color={focus ? theme.text.accent : theme.text.primary} bold={focus}>
        {label}
        {hint && (
          <>
            {' '}
            <Text color={theme.text.secondary}>{hint}</Text>
          </>
        )}
      </Text>
      <Box flexDirection="row" marginTop={1}>
        {normalizedOptions.map((option) => {
          const isSelected = option.value === value;
          return (
            <Box key={option.value} marginRight={2}>
              <Text
                color={isSelected ? theme.status.success : theme.text.secondary}
                bold={isSelected}
              >
                {isSelected ? '[●] ' : '[ ] '}
                {option.label}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
