/**
 * CachedImage — drop-in Image replacement backed by expo-image.
 *
 * Features:
 *  - expo-image handles both memory and disk caching automatically.
 *  - Shows a neutral placeholder while the image is loading, preventing
 *    layout shift (dimensions are required so the space is reserved upfront).
 *  - Records access in our ImageCacheManager metadata ledger for size/eviction
 *    tracking surfaced in Settings › Cache.
 *  - Falls back to a colour placeholder when the URI is absent or the load
 *    fails, keeping layout stable.
 */

import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image as ExpoImage, ImageContentFit } from 'expo-image';
import { imageCache } from '../lib/image-cache';

// ── Types ─────────────────────────────────────────────────────────────────

export interface CachedImageProps {
  /** Remote image URI. When undefined a placeholder fills the space. */
  uri: string | undefined | null;
  /** Width of the image — required so the placeholder reserves exact space. */
  width: number;
  /** Height of the image — required so the placeholder reserves exact space. */
  height: number;
  /** Border radius applied to both the image and the placeholder. */
  borderRadius?: number;
  /** Resizing strategy passed to expo-image. Defaults to 'cover'. */
  contentFit?: ImageContentFit;
  /** Background colour shown while the image is loading. Defaults to #1a1a2e. */
  placeholderColor?: string;
  /** Accessible label for the image. */
  accessibilityLabel?: string;
}

// ── Component ─────────────────────────────────────────────────────────────

export default function CachedImage({
  uri,
  width,
  height,
  borderRadius = 0,
  contentFit = 'cover',
  placeholderColor = '#1a1a2e',
  accessibilityLabel,
}: CachedImageProps) {
  const handleLoad = useCallback(() => {
    if (uri) {
      // Record access asynchronously — fire-and-forget.
      imageCache.recordAccess(uri).catch(() => {});
    }
  }, [uri]);

  if (!uri) {
    // No URI — render a static placeholder to preserve layout.
    return (
      <View
        style={[styles.placeholder, { width, height, borderRadius, backgroundColor: placeholderColor }]}
        accessible={false}
      />
    );
  }

  return (
    // The View provides the placeholder colour immediately (no layout shift).
    // expo-image renders on top and fades in once the disk/network load completes.
    <View style={{ width, height, borderRadius, backgroundColor: placeholderColor, overflow: 'hidden' }}>
      <ExpoImage
        source={{ uri }}
        style={{ width, height }}
        contentFit={contentFit}
        transition={200}
        cachePolicy="disk"
        onLoad={handleLoad}
        accessible={!!accessibilityLabel}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  placeholder: {
    // Dimensions are passed as inline style props; this provides the base.
  },
});
