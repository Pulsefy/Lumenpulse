import React, { useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useNotifications, Notification } from '../contexts/NotificationsContext';
import ProtectedRoute from '../components/ProtectedRoute';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLocalization } from '../src/context';

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const router = useRouter();
  const { t } = useLocalization();

  const renderItem = useCallback(
    ({ item }: { item: Notification }) => (
      <TouchableOpacity
        style={[
          styles.item,
          {
            backgroundColor: item.read ? colors.card : colors.accentSecondary,
            borderColor: item.read ? colors.cardBorder : 'transparent',
          },
        ]}
        onPress={() => markAsRead(item.id)}
        accessibilityLabel={`${item.title}. ${item.read ? t('notifications.read') : t('notifications.unread')}. ${t('notifications.mark_as_read')}`}
        accessibilityRole="button"
        accessibilityState={{ checked: item.read }}
      >
        {!item.read && <View style={styles.unreadDot} accessible accessibilityLabel={t('notifications.unread')} />}
        <Text style={[styles.itemTitle, { color: colors.text }]} accessible accessibilityRole="header">
          {item.title}
        </Text>
        <Text style={[styles.itemMessage, { color: colors.text }]} accessible>
          {item.message}
        </Text>
        <Text style={[styles.itemStatus, { color: colors.text }]} accessible>
          {item.read ? '✓ Read' : '● Unread'}
        </Text>
      </TouchableOpacity>
    ),
    [colors, markAsRead, t],
  );

  return (
    <ProtectedRoute>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.headerRow}>
          {/* Back button */}
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            accessibilityHint="Go back to previous screen"
          >
            <Ionicons name="chevron-back" size={24} color={colors.accent} />
          </TouchableOpacity>

          {/* Title + badge */}
          <View style={styles.titleRow}>
            <Text style={[styles.screenTitle, { color: colors.text }]} accessible accessibilityRole="header">
              {t('notifications.title')}
            </Text>
            {unreadCount > 0 && (
              <View style={styles.badge} accessible accessibilityLabel={`${unreadCount} ${t('notifications.unread')}`}>
                <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            )}
          </View>

          {/* Mark all read */}
          {unreadCount > 0 ? (
            <TouchableOpacity
              onPress={markAllAsRead}
              style={styles.markAllButton}
              accessibilityRole="button"
              accessibilityLabel={t('notifications.mark_all_read')}
            >
              <Text style={[styles.markAllText, { color: colors.accent }]} accessible>
                {t('common.confirm')}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.markAllButton} />
          )}
        </View>

        {notifications.length === 0 ? (
          <View style={styles.emptyState} accessible accessibilityLabel={t('notifications.no_notifications')}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={[styles.emptyText, { color: colors.text }]} accessible accessibilityRole="header">
              {t('notifications.no_notifications')}
            </Text>
            <Text style={[styles.emptySubText, { color: colors.text }]} accessible>
              {t('notifications.notification_text')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={notifications}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            accessibilityLabel={t('notifications.title')}
            accessibilityRole="list"
          />
        )}
      </View>
    </ProtectedRoute>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  backButton: {
    padding: 4,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  screenTitle: { fontSize: 22, fontWeight: '700' },
  badge: {
    backgroundColor: '#ff4757',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: { color: '#ffffff', fontSize: 11, fontWeight: '700', lineHeight: 14 },
  markAllButton: { paddingVertical: 4, paddingHorizontal: 8 },
  markAllText: { fontSize: 13, fontWeight: '600' },
  list: { paddingBottom: 24 },
  item: { padding: 16, borderRadius: 12, marginVertical: 6, borderWidth: 1, position: 'relative' },
  unreadDot: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff4757',
  },
  itemTitle: { fontWeight: '700', fontSize: 15, marginBottom: 4, paddingRight: 16 },
  itemMessage: { fontSize: 13, opacity: 0.85, marginBottom: 6 },
  itemStatus: { fontSize: 10, opacity: 0.6, fontWeight: '600' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  emptyIcon: { fontSize: 40, marginBottom: 8 },
  emptyText: { fontSize: 17, fontWeight: '600' },
  emptySubText: { fontSize: 13, opacity: 0.6, textAlign: 'center', paddingHorizontal: 32 },
});
