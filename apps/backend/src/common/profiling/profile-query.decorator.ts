import { SetMetadata } from '@nestjs/common';

export const PROFILE_QUERY_KEY = 'profile_query';

export interface ProfileQueryMetadata {
  thresholdMs: number;
  label: string;
}

export const ProfileQuery = (
  label: string,
  thresholdMs = 100,
) => {
  return SetMetadata(PROFILE_QUERY_KEY, { label, thresholdMs });
};
