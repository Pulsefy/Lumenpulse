import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinkedStellarAccount } from '../lib/api';
import { useTheme } from '../contexts/ThemeContext';
import { useLocalization } from '../src/context';

const truncateKey = (value: string) => `${value.slice(0, 6)}…${value.slice(-6)}`;

interface AccountSwitcherProps {
  accounts: LinkedStellarAccount[];
  activeAccount: LinkedStellarAccount | null;
  isLoading?: boolean;
  isSwitching?: boolean;
  onSelectAccount: (accountId: string) => Promise<boolean>;
}

export default function AccountSwitcher({
  accounts,
  activeAccount,
  isLoading = false,
  isSwitching = false,
  onSelectAccount,
}: AccountSwitcherProps) {
  const { colors } = useTheme();
  const { t } = useLocalization();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const handleSelect = async (accountId: string) => {
    const switched = await onSelectAccount(accountId);
    if (switched) {
      setOpen(false);
    }
  };

  if (accounts.length === 0) {
    return (
      <View
        style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessible
        accessibilityLabel={t('portfolio.no_linked_accounts')}
      >
        <Ionicons name="wallet-outline" size={22} color={colors.accent} />
        <Text style={[styles.emptyTitle, { color: colors.text }]} accessible>
          {t('portfolio.no_linked_accounts')}
        </Text>
        <Text style={[styles.emptyDescription, { color: colors.textSecondary }]} accessible>
          {t('portfolio.no_linked_accounts_hint')}
        </Text>
        <TouchableOpacity
          style={[styles.linkButton, { backgroundColor: colors.accent }]}
          onPress={() => router.push('/settings/manage-accounts')}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('portfolio.link_account')}
        >
          <Ionicons name="link-outline" size={16} color="#ffffff" />
          <Text style={styles.linkButtonText}>{t('portfolio.link_account')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const displayLabel =
    activeAccount?.label?.trim() ||
    (activeAccount ? truncateKey(activeAccount.publicKey) : t('portfolio.select_wallet'));

  return (
    <>
      <TouchableOpacity
        style={[styles.trigger, { backgroundColor: colors.surface, borderColor: colors.border }]}
        onPress={() => setOpen(true)}
        activeOpacity={0.85}
        disabled={isSwitching}
        accessibilityRole="button"
        accessibilityLabel={t('portfolio.switch_wallet')}
        accessibilityHint={t('portfolio.switch_wallet_hint')}
        accessibilityState={{ expanded: open, busy: isSwitching }}
      >
        <View style={[styles.triggerIcon, { backgroundColor: colors.card }]}>
          <Ionicons name="wallet-outline" size={18} color={colors.accent} />
        </View>

        <View style={styles.triggerCopy}>
          <Text style={[styles.triggerLabel, { color: colors.textSecondary }]} accessible>
            {t('portfolio.active_wallet')}
          </Text>
          <Text style={[styles.triggerValue, { color: colors.text }]} numberOfLines={1} accessible>
            {displayLabel}
          </Text>
          {activeAccount && (
            <Text style={[styles.triggerKey, { color: colors.textSecondary }]} accessible>
              {truncateKey(activeAccount.publicKey)}
            </Text>
          )}
        </View>

        {isLoading || isSwitching ? (
          <ActivityIndicator color={colors.accent} accessibilityLabel={t('common.loading')} />
        ) : (
          <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
        )}
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        accessibilityViewIsModal
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.sheetHeader}>
              <Text
                style={[styles.sheetTitle, { color: colors.text }]}
                accessible
                accessibilityRole="header"
              >
                {t('portfolio.switch_wallet')}
              </Text>
              <TouchableOpacity
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {accounts.map((account, index) => {
              const isActive = account.id === activeAccount?.id;
              const label = account.label?.trim() || t('portfolio.linked_account');

              return (
                <View key={account.id}>
                  {index > 0 && (
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  )}
                  <TouchableOpacity
                    style={styles.accountOption}
                    onPress={() => void handleSelect(account.id)}
                    activeOpacity={0.8}
                    disabled={isSwitching}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={`${label}, ${truncateKey(account.publicKey)}`}
                  >
                    <View style={styles.accountOptionCopy}>
                      <Text style={[styles.accountOptionLabel, { color: colors.text }]} accessible>
                        {label}
                      </Text>
                      <Text
                        style={[styles.accountOptionKey, { color: colors.textSecondary }]}
                        accessible
                      >
                        {truncateKey(account.publicKey)}
                      </Text>
                    </View>
                    {isActive ? (
                      <View style={[styles.activeBadge, { backgroundColor: `${colors.accent}22` }]}>
                        <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
                        <Text style={[styles.activeBadgeText, { color: colors.accent }]} accessible>
                          {t('portfolio.active')}
                        </Text>
                      </View>
                    ) : (
                      <Ionicons name="ellipse-outline" size={18} color={colors.textSecondary} />
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}

            <TouchableOpacity
              style={[styles.manageButton, { borderColor: colors.border }]}
              onPress={() => {
                setOpen(false);
                router.push('/settings/manage-accounts');
              }}
              activeOpacity={0.8}
              accessibilityRole="link"
              accessibilityLabel={t('settings.manage_accounts.title')}
            >
              <Ionicons name="settings-outline" size={16} color={colors.accent} />
              <Text style={[styles.manageButtonText, { color: colors.accent }]} accessible>
                {t('settings.manage_accounts.title')}
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  triggerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerCopy: {
    flex: 1,
    gap: 2,
  },
  triggerLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  triggerValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  triggerKey: {
    fontSize: 12,
  },
  emptyCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  linkButton: {
    marginTop: 4,
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  linkButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  accountOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    gap: 12,
  },
  accountOptionCopy: {
    flex: 1,
    gap: 2,
  },
  accountOptionLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  accountOptionKey: {
    fontSize: 12,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  activeBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  manageButton: {
    marginTop: 14,
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  manageButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
