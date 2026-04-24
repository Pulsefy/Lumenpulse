/* eslint-disable prettier/prettier */
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useNotifications } from '../contexts/NotificationsContext';
import { useRouter } from 'expo-router';
import { parseDeepLinkFromData, navigateToDeepLink } from '../lib/deep-link';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * ForegroundNotificationBanner
 *
 * Displays a non-intrusive banner at the top of the screen when a
 * push notification arrives while the app is in the foreground.
 * Tapping the banner navigates to the deep link target.
 * The banner auto-dismisses after 8 seconds (controlled by NotificationsContext).
 */
export default function ForegroundNotificationBanner() {
  const { colors } = useTheme();
  const { foregroundBanner, dismissBanner } = useNotifications();
  const router = useRouter();
  const slideAnim = React.useRef(new Animated.Value(-100)).current;

  React.useEffect(() => {
    if (foregroundBanner) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 60,
        friction: 12,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [foregroundBanner, slideAnim]);

  if (!foregroundBanner) return null;

  const handleTap = () => {
    if (foregroundBanner.deepLink) {
      navigateToDeepLink(foregroundBanner.deepLink, router);
    }
    dismissBanner();
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY: slideAnim }],
          backgroundColor: colors.card,
          borderColor: colors.cardBorder,
        },
      ]}
    >
      <TouchableOpacity
        style={styles.touchable}
        onPress={handleTap}
        activeOpacity={0.7}
        accessibilityLabel={`Notification: ${foregroundBanner.title}. Tap to view.`}
        accessibilityRole="button"
      >
        <View style={styles.iconContainer}>
          <Ionicons name="notifications" size={20} color={colors.accent} />
        </View>

        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {foregroundBanner.title}
          </Text>
          <Text style={[styles.body, { color: colors.text }]} numberOfLines={2}>
            {foregroundBanner.body}
          </Text>
        </View>

        {foregroundBanner.deepLink && (
          <View style={styles.arrowContainer}>
            <Ionicons name="chevron-forward" size={18} color={colors.accent} />
          </View>
        )}

        <TouchableOpacity
          style={styles.closeButton}
          onPress={dismissBanner}
          accessibilityLabel="Dismiss notification"
        >
          <Ionicons name="close" size={16} color={colors.text} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 9999,
    borderWidth: 1,
    borderRadius: 12,
    marginHorizontal: 8,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  touchable: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  body: {
    fontSize: 12,
    opacity: 0.8,
  },
  arrowContainer: {
    paddingLeft: 4,
  },
  closeButton: {
    padding: 4,
    marginLeft: 4,
  },
});
