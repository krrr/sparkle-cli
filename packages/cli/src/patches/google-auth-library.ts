/**
 * @license
 * Copyright 2026 krrr
 * SPDX-License-Identifier: Apache-2.0
 */

/* used in esbuild.config.js, exclude this lib from @google/gen-ai */
export class GoogleAuth {
  constructor(_options?: unknown) {}

  async getRequestHeaders(_url?: string): Promise<Record<string, string>> {
    throw new Error(
      'Google Cloud / Vertex AI authentication (google-auth-library) is disabled in this build. Please provide a GEMINI_API_KEY.',
    );
  }

  async getAccessToken(): Promise<string | null> {
    throw new Error(
      'Google Cloud / Vertex AI authentication (google-auth-library) is disabled in this build. Please provide a GEMINI_API_KEY.',
    );
  }
}

export class OAuth2Client extends GoogleAuth {}
export class Compute extends OAuth2Client {}
export class JWT extends OAuth2Client {}
export class UserRefreshClient extends OAuth2Client {}
export class IdTokenClient extends OAuth2Client {}

// eslint-disable-next-line import/no-default-export
export default {
  GoogleAuth,
  OAuth2Client,
  Compute,
  JWT,
  UserRefreshClient,
  IdTokenClient,
};
