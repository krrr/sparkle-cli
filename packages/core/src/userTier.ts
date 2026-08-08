/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Credit types that can be used for API consumption.
 */
export type CreditType = 'CREDIT_TYPE_UNSPECIFIED' | 'GOOGLE_ONE_AI';

/**
 * Represents a credit amount for a specific credit type.
 */
export interface Credits {
  creditType: CreditType;
  creditAmount: string; // int64 represented as string in JSON
}

/** Alias for Credits used in available_credits context */
export type AvailableCredits = Credits;

/** Alias for Credits used in consumedCredits context */
export type ConsumedCredits = Credits;

/** Alias for Credits used in remainingCredits context */
export type RemainingCredits = Credits;

/**
 * GeminiUserTier reflects the structure of a user tier.
 */
export interface GeminiUserTier {
  id?: UserTierId;
  name?: string;
  description?: string;
  userDefinedCloudaicompanionProject?: boolean | null;
  isDefault?: boolean;
  privacyNotice?: PrivacyNotice;
  hasAcceptedTos?: boolean;
  hasOnboardedPreviously?: boolean;
  /** Available AI credits for this tier (e.g., Google One AI credits) */
  availableCredits?: AvailableCredits[];
}

/**
 * UserTierId represents IDs of a user's tier.
 */
export const UserTierId = {
  FREE: 'free-tier',
  LEGACY: 'legacy-tier',
  STANDARD: 'standard-tier',
} as const;

export type UserTierId = (typeof UserTierId)[keyof typeof UserTierId] | string;

/**
 * PrivacyNotice reflects the structure of a tier privacy notice.
 */
export interface PrivacyNotice {
  showNotice?: boolean;
  noticeText?: string;
}

export interface RetrieveUserQuotaRequest {
  project: string;
  userAgent?: string;
}

export interface BucketInfo {
  remainingAmount?: string;
  remainingFraction?: number;
  resetTime?: string;
  tokenType?: string;
  modelId?: string;
}

export interface RetrieveUserQuotaResponse {
  buckets?: BucketInfo[];
}
