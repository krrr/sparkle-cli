/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  allowEditorTypeInSandbox,
  hasValidEditorCommand,
  type EditorType,
  EDITOR_DISPLAY_NAMES,
  debugLogger,
} from 'sparkle-cli-core';

export interface EditorDisplay {
  name: string;
  type: EditorType | 'not_set';
  disabled: boolean;
}

export class EditorSettingsManager {
  private availableEditors: EditorDisplay[] | null = null;

  constructor() {}

  private computeAvailableEditors(): EditorDisplay[] {
    debugLogger.log(`computeAvailableEditors`);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const editorTypes = Object.keys(
      EDITOR_DISPLAY_NAMES,
    ).sort() as EditorType[];
    return [
      {
        name: 'None',
        type: 'not_set',
        disabled: false,
      },
      ...editorTypes.map((type) => {
        const hasEditor = hasValidEditorCommand(type);
        const isAllowedInSandbox = allowEditorTypeInSandbox(type);

        let labelSuffix = !isAllowedInSandbox
          ? ' (Not available in sandbox)'
          : '';
        labelSuffix = !hasEditor ? ' (Not installed)' : labelSuffix;

        return {
          name: EDITOR_DISPLAY_NAMES[type] + labelSuffix,
          type,
          disabled: !hasEditor || !isAllowedInSandbox,
        };
      }),
    ];
  }

  getAvailableEditorDisplays(): EditorDisplay[] {
    if (this.availableEditors === null) {
      this.availableEditors = this.computeAvailableEditors();
    }
    return this.availableEditors;
  }
}

export const editorSettingsManager = new EditorSettingsManager();
