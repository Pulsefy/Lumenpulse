import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useWallet } from '../../contexts/WalletContext';
import { useLocalization } from '../../src/context';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import { usersApi, UserProfileResponse } from '../../lib/api';
import {
  contributorApi,
  ContributorProfile,
  ReputationData,
  VerificationState,
  getTierColor,
  getVerificationStatusColor,
  getVerificationStatusLabel,
} from '../../lib/contributor';
import ListSkeleton from '../../components/ListSkeleton';

export default function ContributorProfileScreen() {
  const router = useRouter();
  const { colors, t } = useLocalization();
  const { isAuthenticated } = useAuth();
  const { publicKey: activeWalletPublicKey, status: walletStatus, connect: connectWallet } = useWallet();
  const { environmentConfig } = useEnvironment();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfileResponse | null>(null);
  const [contributorProfile, setContributorProfile] = useState<ContributorProfile | null>(null);
  const [reputationData, setReputationData] = useState<ReputationData | null>(null);
  const [verificationState, setVerificationState] = useState<VerificationState | null>(null);

  const effectiveAddress = activeWalletPublicKey || userProfile?.stellarPublicKey || null;

  const loadData = useCallback(async () => {
    setError(null);
    try {
      let fetchedUser: UserProfileResponse | null = null;
      if (isAuthenticated) {
        const userRes = await usersApi.getProfile();
        if (userRes.success && userRes.data) {
          fetchedUser = userRes.data;
          setUserProfile(fetchedUser);
        }
      }

      const targetAddress = activeWalletPublicKey || fetchedUser?.stellarPublicKey;

      if (targetAddress) {
        const [profileRes, repRes, verifRes] = await Promise.all([
          contributorApi.getByAddress(targetAddress),
          contributorApi.getReputation(targetAddress),
          contributorApi.getVerificationState(targetAddress),
        ]);

        if (profileRes.success && profileRes.data) {
          setContributorProfile(profileRes.data);
        } else {
          setContributorProfile(null);
        }

        if (repRes.success && repRes.data) {
          setReputationData(repRes.data);
        } else {
          setReputationData(null);
        }

        if (verifRes.success && verifRes.data) {
          setVerificationState(verifRes.data);
        }
      } else {
        // Fallback demo data if user has no address set yet but wants to explore
        setVerificationState({
          status: 'UNREGISTERED',
          quorumProgress: 0,
          votesFor: 0,
          votesAgainst: 0,
          quorumThreshold: 10,
          requirements: [
            {
              id: 'wallet_linked',
              label: 'Stellar Wallet Connected',
              fulfilled: false,
              description: 'Link your Stellar wallet (G...) to activate contributor identity.',
            },
            {
              id: 'onchain_registry',
              label: 'Soroban Contributor Registry',
              fulfilled: false,
              description: 'Register on-chain in the Soroban ContributorRegistry contract.',
            },
            {
              id: 'github_identity',
              label: 'GitHub Identity Bound',
              fulfilled: false,
              description: 'Bind your GitHub handle to your on-chain contributor record.',
            },
            {
              id: 'quorum_review',
              label: 'Community Quorum Review',
              fulfilled: false,
              description: 'Attain required votes for verified contributor status.',
            },
          ],
        });
      }
    } catch (err) {
      console.error('Error loading contributor profile:', err);
      setError(err instanceof Error ? err.message : t('errors.something_went_wrong'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAuthenticated, activeWalletPublicKey, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const handleCopyAddress = (addr: string) => {
    Clipboard.setString(addr);
    Alert.alert(t('common.info'), t('contributor_profile.address_copied'));
  };

  const formatShortAddress = (addr: string) => {
    if (!addr || addr.length < 12) return addr;
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 6)}`;
  };

  const currentTier = reputationData?.tier || contributorProfile?.tier || 'Novice';
  const tierColor = getTierColor(currentTier);
  const verifStatus = verificationState?.status || 'UNREGISTERED';
  const verifColor = getVerificationStatusColor(verifStatus);
  const verifLabel = getVerificationStatusLabel(verifStatus);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top Header Bar */}
      <View style={[styles.topHeader, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {t('contributor_profile.title')}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {t('contributor_profile.subtitle')}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshHeaderButton}
          onPress={onRefresh}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel={t('common.retry')}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons name="refresh-outline" size={20} color={colors.accent} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        }
      >
        {loading ? (
          <View style={styles.loadingWrap}>
            <ListSkeleton count={4} />
          </View>
        ) : error ? (
          /* Error State */
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.notFoundCenter}>
              <Ionicons name="alert-circle-outline" size={48} color={colors.danger} />
              <Text style={[styles.notFoundTitle, { color: colors.text }]}>{t('common.error')}</Text>
              <Text style={[styles.notFoundDesc, { color: colors.textSecondary }]}>{error}</Text>
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: colors.accent }]}
                onPress={loadData}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh" size={18} color="#ffffff" style={{ marginRight: 6 }} />
                <Text style={styles.primaryButtonText}>{t('common.retry')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : !effectiveAddress && !contributorProfile ? (
          /* Not Found / Unregistered State */
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.notFoundCenter}>
              <View style={[styles.iconShellLarge, { backgroundColor: colors.card }]}>
                <Ionicons name="person-circle-outline" size={56} color={colors.accent} />
              </View>
              <Text style={[styles.notFoundTitle, { color: colors.text }]}>
                {t('contributor_profile.not_found_title')}
              </Text>
              <Text style={[styles.notFoundDesc, { color: colors.textSecondary }]}>
                {t('contributor_profile.not_found_desc')}
              </Text>

              <View style={styles.notFoundActions}>
                <TouchableOpacity
                  style={[styles.primaryButton, { backgroundColor: colors.accent }]}
                  onPress={connectWallet}
                  activeOpacity={0.8}
                >
                  <Ionicons name="wallet-outline" size={18} color="#ffffff" style={{ marginRight: 8 }} />
                  <Text style={styles.primaryButtonText}>{t('contributor_profile.connect_wallet')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
                  onPress={() => router.push('/settings/manage-accounts')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="link-outline" size={18} color={colors.text} style={{ marginRight: 8 }} />
                  <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                    {t('contributor_profile.manage_wallets')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          <>
            {/* 1. Contributor Identity Card */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.identityHeaderRow}>
                <View style={[styles.avatarCircle, { backgroundColor: tierColor + '20', borderColor: tierColor }]}>
                  <Ionicons name="person" size={32} color={tierColor} />
                </View>

                <View style={styles.identityMetaWrap}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.displayName, { color: colors.text }]} numberOfLines={1}>
                      {userProfile?.displayName ||
                        (userProfile?.email ? userProfile.email.split('@')[0] : 'Contributor')}
                    </Text>
                    <View style={[styles.tierBadge, { backgroundColor: tierColor + '25', borderColor: tierColor }]}>
                      <Text style={[styles.tierBadgeText, { color: tierColor }]}>{currentTier}</Text>
                    </View>
                  </View>

                  {userProfile?.email && (
                    <Text style={[styles.emailText, { color: colors.textSecondary }]} numberOfLines={1}>
                      {userProfile.email}
                    </Text>
                  )}

                  {contributorProfile?.githubHandle && (
                    <View style={styles.githubChip}>
                      <Ionicons name="logo-github" size={14} color={colors.accent} />
                      <Text style={[styles.githubChipText, { color: colors.accent }]}>
                        @{contributorProfile.githubHandle}
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />

              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Text style={[styles.statValue, { color: colors.text }]}>
                    {reputationData?.reputationScore ?? contributorProfile?.reputationScore ?? 0}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                    {t('contributor_profile.reputation_score')}
                  </Text>
                </View>

                <View style={[styles.statDividerVertical, { backgroundColor: colors.border }]} />

                <View style={styles.statBox}>
                  <Text style={[styles.statValue, { color: verifColor }]}>{verifStatus}</Text>
                  <Text style={[styles.statLabel, { color: colors.textSecondary }]}>Review Status</Text>
                </View>
              </View>
            </View>

            {/* 2. Verification & Review Progress Card */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeaderRow}>
                <Ionicons name="shield-checkmark" size={20} color={verifColor} />
                <Text style={[styles.cardSectionTitle, { color: colors.text }]}>
                  {t('contributor_profile.verification_section')}
                </Text>
              </View>

              {/* Status Banner */}
              <View
                style={[
                  styles.statusBanner,
                  { backgroundColor: verifColor + '15', borderColor: verifColor + '40' },
                ]}
              >
                <View style={[styles.statusDot, { backgroundColor: verifColor }]} />
                <Text style={[styles.statusBannerText, { color: verifColor }]}>{verifLabel}</Text>
              </View>

              {/* Progress Bar */}
              <View style={styles.progressContainer}>
                <View style={styles.progressLabelRow}>
                  <Text style={[styles.progressLabel, { color: colors.textSecondary }]}>
                    {t('contributor_profile.quorum_progress')}
                  </Text>
                  <Text style={[styles.progressValueText, { color: colors.text }]}>
                    {verificationState?.quorumProgress ?? 0}%
                  </Text>
                </View>
                <View style={[styles.trackBar, { backgroundColor: colors.card }]}>
                  <View
                    style={[
                      styles.fillBar,
                      {
                        width: `${Math.min(100, Math.max(0, verificationState?.quorumProgress ?? 0))}%`,
                        backgroundColor: verifColor,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.progressHintText, { color: colors.textSecondary }]}>
                  {t('contributor_profile.quorum_votes', {
                    votesFor: verificationState?.votesFor ?? 0,
                    quorumThreshold: verificationState?.quorumThreshold ?? 10,
                  })}
                </Text>
              </View>

              <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />

              {/* Checklist */}
              <Text style={[styles.checklistHeader, { color: colors.text }]}>
                {t('contributor_profile.verification_checklist')}
              </Text>
              {verificationState?.requirements.map((req) => (
                <View key={req.id} style={styles.checkItemRow}>
                  <Ionicons
                    name={req.fulfilled ? 'checkmark-circle' : 'ellipse-outline'}
                    size={20}
                    color={req.fulfilled ? colors.success : colors.textSecondary}
                  />
                  <View style={styles.checkItemCopy}>
                    <Text
                      style={[
                        styles.checkItemTitle,
                        { color: req.fulfilled ? colors.text : colors.textSecondary },
                      ]}
                    >
                      {req.label}
                    </Text>
                    <Text style={[styles.checkItemDesc, { color: colors.textSecondary }]}>
                      {req.description}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            {/* 3. Linked Wallet Context Card */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeaderRow}>
                <Ionicons name="wallet-outline" size={20} color={colors.accent} />
                <Text style={[styles.cardSectionTitle, { color: colors.text }]}>
                  {t('contributor_profile.wallet_section')}
                </Text>
              </View>

              {effectiveAddress ? (
                <>
                  <View style={styles.walletDetailRow}>
                    <View style={styles.walletCopyWrap}>
                      <Text style={[styles.walletAddressLabel, { color: colors.textSecondary }]}>
                        Primary Public Key (Stellar)
                      </Text>
                      <Text style={[styles.walletAddressText, { color: colors.text }]} numberOfLines={1}>
                        {effectiveAddress}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={[styles.iconActionButton, { backgroundColor: colors.card }]}
                      onPress={() => handleCopyAddress(effectiveAddress)}
                      accessibilityRole="button"
                      accessibilityLabel={t('contributor_profile.copy_address')}
                    >
                      <Ionicons name="copy-outline" size={18} color={colors.accent} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.walletStatusRow}>
                    <Text style={[styles.walletStatusLabel, { color: colors.textSecondary }]}>
                      Connection Status:
                    </Text>
                    <View
                      style={[
                        styles.walletStatusBadge,
                        {
                          backgroundColor:
                            walletStatus === 'connected'
                              ? colors.success + '20'
                              : colors.warning + '20',
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.statusDot,
                          {
                            backgroundColor:
                              walletStatus === 'connected' ? colors.success : colors.warning,
                          },
                        ]}
                      />
                      <Text
                        style={[
                          styles.walletStatusText,
                          {
                            color: walletStatus === 'connected' ? colors.success : colors.warning,
                          },
                        ]}
                      >
                        {walletStatus.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                </>
              ) : (
                <View style={styles.noWalletBox}>
                  <Text style={[styles.noWalletText, { color: colors.textSecondary }]}>
                    {t('contributor_profile.no_wallet_desc')}
                  </Text>
                  <TouchableOpacity
                    style={[styles.primaryButtonInline, { backgroundColor: colors.accent }]}
                    onPress={connectWallet}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="wallet" size={16} color="#ffffff" style={{ marginRight: 6 }} />
                    <Text style={styles.primaryButtonText}>{t('contributor_profile.connect_wallet')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity
                style={[styles.manageWalletsLink, { borderColor: colors.border }]}
                onPress={() => router.push('/settings/manage-accounts')}
                activeOpacity={0.7}
              >
                <Text style={[styles.manageWalletsLinkText, { color: colors.accent }]}>
                  {t('contributor_profile.manage_wallets')}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.accent} />
              </TouchableOpacity>
            </View>

            {/* 4. Account & Platform Details Card */}
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardHeaderRow}>
                <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
                <Text style={[styles.cardSectionTitle, { color: colors.text }]}>
                  {t('contributor_profile.account_section')}
                </Text>
              </View>

              <View style={styles.infoLine}>
                <Text style={[styles.infoLineLabel, { color: colors.textSecondary }]}>Account ID</Text>
                <Text style={[styles.infoLineValue, { color: colors.text }]} numberOfLines={1}>
                  {userProfile?.id || 'Local / Guest'}
                </Text>
              </View>

              <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />

              <View style={styles.infoLine}>
                <Text style={[styles.infoLineLabel, { color: colors.textSecondary }]}>Network Environment</Text>
                <View style={[styles.badgePill, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <Text style={[styles.badgePillText, { color: colors.accent }]}>
                    {environmentConfig.label}
                  </Text>
                </View>
              </View>

              <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />

              <View style={styles.infoLine}>
                <Text style={[styles.infoLineLabel, { color: colors.textSecondary }]}>Stellar Soroban Contract</Text>
                <Text style={[styles.infoLineValue, { color: colors.text }]} numberOfLines={1}>
                  contributor-registry
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    padding: 6,
  },
  headerTitleWrap: {
    flex: 1,
    marginHorizontal: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 12,
  },
  refreshHeaderButton: {
    padding: 6,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 16,
  },
  loadingWrap: {
    paddingVertical: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 8,
  },
  cardSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 14,
  },
  /* Identity Card */
  identityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityMetaWrap: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  displayName: {
    fontSize: 18,
    fontWeight: '800',
    flexShrink: 1,
  },
  tierBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
  },
  tierBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emailText: {
    fontSize: 13,
    marginTop: 2,
  },
  githubChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  githubChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  statDividerVertical: {
    width: StyleSheet.hairlineWidth,
    height: 36,
  },
  /* Verification Card */
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    marginBottom: 16,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusBannerText: {
    fontSize: 14,
    fontWeight: '700',
  },
  progressContainer: {
    gap: 6,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressValueText: {
    fontSize: 14,
    fontWeight: '700',
  },
  trackBar: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fillBar: {
    height: '100%',
    borderRadius: 4,
  },
  progressHintText: {
    fontSize: 12,
  },
  checklistHeader: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  checkItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  checkItemCopy: {
    flex: 1,
  },
  checkItemTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  checkItemDesc: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  /* Wallet Context Card */
  walletDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  walletCopyWrap: {
    flex: 1,
  },
  walletAddressLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  walletAddressText: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Platform',
  },
  iconActionButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  walletStatusLabel: {
    fontSize: 13,
  },
  walletStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 6,
  },
  walletStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  noWalletBox: {
    paddingVertical: 12,
    alignItems: 'center',
    gap: 10,
  },
  noWalletText: {
    fontSize: 13,
    textAlign: 'center',
  },
  manageWalletsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  manageWalletsLinkText: {
    fontSize: 14,
    fontWeight: '600',
  },
  /* Account Details */
  infoLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLineLabel: {
    fontSize: 14,
  },
  infoLineValue: {
    fontSize: 14,
    fontWeight: '600',
    maxWidth: '55%',
  },
  badgePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgePillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  /* Not Found / Error UI */
  notFoundCenter: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 10,
  },
  iconShellLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  notFoundTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  notFoundDesc: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  notFoundActions: {
    width: '100%',
    gap: 10,
  },
  primaryButton: {
    flexDirection: 'row',
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primaryButtonInline: {
    flexDirection: 'row',
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    flexDirection: 'row',
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
