/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback, useEffect } from 'react';
import { Box } from 'ink';
import { theme } from '../semantic-colors.js';
import {
  type ProviderProfile,
  type ProviderModel,
  saveApiKeyForProfile,
  getErrorMessage,
  type ProviderType,
} from 'sparkle-cli-core';
import { useConfig } from '../contexts/ConfigContext.js';
import { AuthState } from '../types.js';
import { ProviderListView } from './ProviderListView.js';
import { ProviderEditorView } from './ProviderEditorView.js';
import { ProviderModelsView } from './ProviderModelsView.js';

export interface ProviderManagerDialogProps {
  setAuthState: (state: AuthState) => void;
  authError: string | null;
  onAuthError: (error: string | null) => void;
}

export function ProviderManagerDialog({
  setAuthState,
  authError,
  onAuthError,
}: ProviderManagerDialogProps): React.JSX.Element {
  const config = useConfig();
  const profileService = config?.getProviderProfileService();

  const [view, setView] = useState<'list' | 'editor' | 'models'>('list');
  const [editingProfile, setEditingProfile] = useState<
    ProviderProfile | undefined
  >(undefined);
  const [modelsProfileId, setModelsProfileId] = useState<string | undefined>(
    undefined,
  );
  const [localError, setLocalError] = useState<string | null>(authError);

  const [profiles, setProfiles] = useState<ProviderProfile[]>(
    () => profileService?.listProfiles() || [],
  );
  const [activeProfile, setActiveProfile] = useState<
    ProviderProfile | undefined
  >(() => profileService?.getActiveProfile());

  const refreshProfiles = useCallback(() => {
    if (!profileService) return;
    setProfiles(profileService.listProfiles());
    setActiveProfile(profileService.getActiveProfile());
  }, [profileService]);

  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  const activeProfileId = activeProfile?.id;
  const modelsProfile = profiles.find((p) => p.id === modelsProfileId);

  const handleActivate = useCallback(
    async (profile: ProviderProfile) => {
      if (!profileService) return;
      try {
        setLocalError(null);
        onAuthError(null);
        await profileService.activateProfile(profile.id);
        refreshProfiles();
        setAuthState(AuthState.Authenticated);
      } catch (e) {
        const msg = getErrorMessage(e);
        setLocalError(msg);
        onAuthError(msg);
      }
    },
    [profileService, refreshProfiles, setAuthState, onAuthError],
  );

  const handleAdd = useCallback(() => {
    setEditingProfile(undefined);
    setLocalError(null);
    setView('editor');
  }, []);

  const handleEdit = useCallback((profile: ProviderProfile) => {
    setEditingProfile(profile);
    setLocalError(null);
    setView('editor');
  }, []);

  const handleManageModels = useCallback((profile: ProviderProfile) => {
    setModelsProfileId(profile.id);
    setLocalError(null);
    setView('models');
  }, []);

  const handleDelete = useCallback(
    async (profile: ProviderProfile) => {
      if (!profileService) return;
      try {
        setLocalError(null);
        await profileService.deleteProfile(profile.id);
        refreshProfiles();
      } catch (e) {
        setLocalError(getErrorMessage(e));
      }
    },
    [profileService, refreshProfiles],
  );

  const handleClose = useCallback(() => {
    if (activeProfile) {
      setLocalError(null);
      onAuthError(null);
      setAuthState(AuthState.Authenticated);
    } else {
      setLocalError(
        'You must configure and activate a provider before proceeding. Press Ctrl+C twice to exit.',
      );
    }
  }, [activeProfile, setAuthState, onAuthError]);

  const handleSaveEditor = useCallback(
    async (
      data: {
        id?: string;
        providerType: ProviderType;
        baseUrl?: string;
      },
      apiKey: string,
    ) => {
      if (!profileService) return;
      try {
        setLocalError(null);
        let savedProfile: ProviderProfile;
        if (editingProfile) {
          const targetId = data.id || editingProfile.id;
          await profileService.updateProfile(editingProfile.id, {
            id: data.id,
            providerType: data.providerType,
            baseUrl: data.baseUrl,
          });
          savedProfile = profileService.getProfile(targetId)!;
        } else {
          if (!data.id) {
            setLocalError('Provider ID is required.');
            return;
          }
          savedProfile = await profileService.createProfile({
            id: data.id,
            providerType: data.providerType,
            baseUrl: data.baseUrl,
          });
        }

        if (apiKey) {
          await saveApiKeyForProfile(savedProfile.id, apiKey);
        }

        // If newly created and no active profile, or if this is the only profile,
        // activate it directly (without handleActivate calling setAuthState closing dialog)
        if (!activeProfile || profiles.length === 0) {
          await profileService.activateProfile(savedProfile.id);
        }

        refreshProfiles();

        // Newly created providers jump straight into model management; edits
        // return to the provider list.
        if (editingProfile) {
          setView('list');
        } else {
          setModelsProfileId(savedProfile.id);
          setView('models');
        }
      } catch (e) {
        setLocalError(getErrorMessage(e));
      }
    },
    [profileService, editingProfile, activeProfile, profiles, refreshProfiles],
  );

  const handleAddModel = useCallback(
    async (model: ProviderModel) => {
      if (!profileService || !modelsProfileId) return;
      try {
        setLocalError(null);
        await profileService.addModel(modelsProfileId, model);
        refreshProfiles();
      } catch (e) {
        setLocalError(getErrorMessage(e));
      }
    },
    [profileService, modelsProfileId, refreshProfiles],
  );

  const handleUpdateModel = useCallback(
    async (oldModelId: string, model: ProviderModel) => {
      if (!profileService || !modelsProfileId) return;
      try {
        setLocalError(null);
        await profileService.updateModel(modelsProfileId, oldModelId, model);
        refreshProfiles();
      } catch (e) {
        setLocalError(getErrorMessage(e));
      }
    },
    [profileService, modelsProfileId, refreshProfiles],
  );

  const handleDeleteModel = useCallback(
    async (modelId: string) => {
      if (!profileService || !modelsProfileId) return;
      try {
        setLocalError(null);
        await profileService.removeModel(modelsProfileId, modelId);
        refreshProfiles();
      } catch (e) {
        setLocalError(getErrorMessage(e));
      }
    },
    [profileService, modelsProfileId, refreshProfiles],
  );

  const handleSetDefaultModel = useCallback(
    async (modelId: string) => {
      if (!profileService || !modelsProfileId) return;
      try {
        setLocalError(null);
        await profileService.setDefaultModel(modelsProfileId, modelId);
        refreshProfiles();
      } catch (e) {
        setLocalError(getErrorMessage(e));
      }
    },
    [profileService, modelsProfileId, refreshProfiles],
  );

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      {view === 'list' && (
        <ProviderListView
          profiles={profiles}
          activeProfileId={activeProfileId}
          onActivate={handleActivate}
          onAdd={handleAdd}
          onEdit={handleEdit}
          onManageModels={handleManageModels}
          onDelete={handleDelete}
          onClose={handleClose}
          error={localError}
        />
      )}

      {view === 'editor' && (
        <ProviderEditorView
          profile={editingProfile}
          onSave={handleSaveEditor}
          onCancel={() => {
            setLocalError(null);
            setView('list');
          }}
          error={localError}
        />
      )}

      {view === 'models' && modelsProfile && (
        <ProviderModelsView
          profile={modelsProfile}
          onAddModel={handleAddModel}
          onUpdateModel={handleUpdateModel}
          onDeleteModel={handleDeleteModel}
          onSetDefaultModel={handleSetDefaultModel}
          onBack={() => {
            setLocalError(null);
            setView('list');
          }}
          error={localError}
        />
      )}
    </Box>
  );
}
