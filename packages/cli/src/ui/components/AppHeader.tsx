/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { Tips } from './Tips.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { useConfig } from '../contexts/ConfigContext.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { Banner } from './Banner.js';
import { useBanner } from '../hooks/useBanner.js';
import { useTips } from '../hooks/useTips.js';
import { theme } from '../semantic-colors.js';
import { ThemedGradient } from './ThemedGradient.js';
import { CliSpinner } from './CliSpinner.js';

import { ProviderType, type ProviderProfile } from 'sparkle-cli-core';

interface AppHeaderProps {
  version: string;
  showDetails?: boolean;
}

const DEFAULT_ICON = `   ⣰⣆
⢀⣠⣴⣿⣿⣦⣄⡀
⠈⠙⠻⣿⣿⠟⠋⠁
   ⠹⠏`;

/**
 * The terminal width below which we switch to a narrow/column layout to prevent
 * UI elements from wrapping or overlapping.
 */
const NARROW_TERMINAL_BREAKPOINT = 60;

function getProviderLabel(providerProfile?: ProviderProfile): string | null {
  if (!providerProfile) {
    return null;
  }
  const type =
    providerProfile.providerType === ProviderType.USE_GEMINI
      ? 'Gemini'
      : 'OpenAI Compatible';
  return `${providerProfile.id} (${type})`;
}

export const AppHeader = ({ version, showDetails = true }: AppHeaderProps) => {
  const settings = useSettings();
  const config = useConfig();
  const { terminalWidth, bannerData, bannerVisible, updateInfo } = useUIState();

  const { bannerText } = useBanner(bannerData);
  const { showTips } = useTips();

  const activeProvider = config.getProviderProfileService()?.getActiveProfile();
  const providerLabel = getProviderLabel(activeProvider);

  const showHeader = !(
    settings.merged.ui.hideBanner || config.getScreenReader()
  );

  // If the terminal is too narrow to fit the icon and metadata (especially long nightly versions)
  // side-by-side, we switch to column mode to prevent wrapping.
  const isNarrow = terminalWidth < NARROW_TERMINAL_BREAKPOINT;

  const renderLogo = () => (
    <Box flexDirection="row">
      <Box flexShrink={0}>
        <ThemedGradient>{DEFAULT_ICON}</ThemedGradient>
      </Box>
    </Box>
  );

  const renderMetadata = (isBelow = false) => (
    <Box marginLeft={isBelow ? 0 : 2} flexDirection="column">
      {/* Line 1: Sparkle CLI vVersion [Updating] */}
      <Box>
        <Text bold color={theme.text.primary}>
          Sparkle CLI
        </Text>
        <Text color={theme.text.secondary}> v{version}</Text>
        {updateInfo?.isUpdating && (
          <Box marginLeft={2}>
            <Text color={theme.text.secondary}>
              <CliSpinner /> Updating
            </Text>
          </Box>
        )}
      </Box>

      {showDetails && (
        <>
          {/* Line 2: Blank */}
          <Box height={1} />
          {/* Line 3: Currently configured provider (auth type) */}
          {providerLabel && (
            <Box>
              <Text color={theme.text.secondary}>
                Provider: {providerLabel}
              </Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );

  const useColumnLayout = isNarrow;

  return (
    <Box flexDirection="column">
      {showHeader && (
        <Box
          flexDirection={useColumnLayout ? 'column' : 'row'}
          marginTop={1}
          marginBottom={1}
          paddingLeft={1}
        >
          {renderLogo()}
          {useColumnLayout ? (
            <Box marginTop={1}>{renderMetadata(true)}</Box>
          ) : (
            renderMetadata(false)
          )}
        </Box>
      )}

      {bannerVisible && bannerText && (
        <Banner
          width={terminalWidth}
          bannerText={bannerText}
          isWarning={bannerData.warningText !== ''}
        />
      )}

      {!(settings.merged.ui.hideTips || config.getScreenReader()) &&
        showTips && <Tips config={config} />}
    </Box>
  );
};
