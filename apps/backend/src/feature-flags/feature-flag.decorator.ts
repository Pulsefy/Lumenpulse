import { SetMetadata } from '@nestjs/common';

export const FEATURE_FLAG_KEY = 'feature_flag_key';

export const FeatureFlag = (key: string) => SetMetadata(FEATURE_FLAG_KEY, key);
