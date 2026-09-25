import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Clipboard,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEnvironment } from '../../contexts/EnvironmentContext';
import { useLocalization } from '../../src/context';
import { config } from '../../lib/config';
import {
  buildDiagnosticsBlock,
  checkForRuntimeUpdate,
  DiagnosticsContext,
  getReleaseMetadata,
  getRuntimeUpdateInfo,
  ReleaseInfo,
  RuntimeUpdateInfo,
  UpdateCheckResult,
  UpdateCheckStatus,
} from '../../lib/release-metadata';
import axios from 'axios';

type ConnectionStatus = 'idle' | 'testing' | 'online' | 'offline';

function updateStatusColor(
  status: UpdateCheckStatus,
  palette: { success: string; danger: string; warning: string; accent: string; textSecondary: string },
): string {
  switch (status) {
    case 'available':
    case 'roll-back-available':
      return palette.accent;
    case 'up-to-date':
      return palette.success;
    case 'error':
      return palette.danger;
    case 'checking':
      return palette.warning;
    case 'unsupported':
    case 'idle':
    default:
      return palette.textSecondary;
  }
}

function formatUpdateId(updateId: string | null, fallback: string): string {
  if (!updateId) return fallback;
  if (updateId.length <= 10) return updateId;
  return `${updateId.slice(0, 6)}…${updateId.slice(-4)}`;
}

export default function StatusScreen() {
  const router = useRouter();
  const { colors, t } = useLocalization();
  const { environment, environmentConfig } = useEnvironment();

  const [releaseNotes, setReleaseNotes] = useState<ReleaseInfo[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeUpdateInfo>(() => getRuntimeUpdateInfo());
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult>({
    status: 'idle',
    message: null,
    newUpdateId: null,
    createdAt: null,
  });
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);

  useEffect(() => {
    const data = getReleaseMetadata();
    setReleaseNotes(data.releases);
  }, []);

  useEffect(() => {
    setRuntimeInfo(getRuntimeUpdateInfo());
  }, []);

  const handleTestConnection = async () => {
    if (connectionStatus === 'testing') return;

    setConnectionStatus('testing');

    const targetUrl = environmentConfig.apiBaseUrl;
    if (!targetUrl) {
      setConnectionStatus('offline');
      setLastChecked(new Date().toLocaleTimeString());
      return;
    }

    try {
      const source = axios.CancelToken.source();
      const timeout = setTimeout(() => {
        source.cancel('Timeout');
      }, 5000);

      await axios.get(targetUrl, {
        cancelToken: source.token,
        validateStatus: () => true,
      });

      clearTimeout(timeout);
      setConnectionStatus('online');
    } catch (error) {
      console.warn('Connection test failed:', error);
      setConnectionStatus('offline');
    } finally {
      setLastChecked(new Date().toLocaleTimeString());
    }
  };

  const handleCheckForUpdate = useCallback(async () => {
    setUpdateCheck((prev) =>
      prev.status === 'checking'
        ? prev
        : { ...prev, status: 'checking', message: null },
    );
    const result = await checkForRuntimeUpdate();
    setUpdateCheck(result);
  }, []);

  const diagnosticsContext = useMemo<DiagnosticsContext>(
    () => ({
      environment,
      environmentLabel: environmentConfig.label,
      apiBaseUrl: environmentConfig.apiBaseUrl || null,
      stellarNetwork: environmentConfig.stellarNetwork || null,
      sorobanRpcUrl: environmentConfig.sorobanRpcUrl || null,
      crowdfundContractId: environmentConfig.crowdfundContractId || null,
      connectionStatus,
      lastCheckedAt: lastChecked,
    }),
    [environment, environmentConfig, connectionStatus, lastChecked],
  );

  const handleCopyDiagnostics = useCallback(async () => {
    try {
      const block = buildDiagnosticsBlock(diagnosticsContext);
      await Clipboard.setString(block);
      setDiagnosticsCopied(true);
      setTimeout(() => setDiagnosticsCopied(false), 2500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert('Unable to copy diagnostics', message);
    }
  }, [diagnosticsContext]);

  const getStatusColor = (status: ConnectionStatus) => {
    switch (status) {
      case 'online':
        return colors.success;
      case 'offline':
        return colors.danger;
      case 'testing':
        return colors.warning;
      default:
        return colors.textSecondary;
    }
  };

  const getStatusText = (status: ConnectionStatus) => {
    switch (status) {
      case 'online':
        return t('settings.status_info.online');
      case 'offline':
        return t('settings.status_info.offline');
      case 'testing':
        return t('settings.status_info.testing');
      default:
        return t('common.retry');
    }
  };

  const updateCheckCta = (() => {
    switch (updateCheck.status) {
      case 'checking':
        return 'Checking…';
      case 'available':
      case 'roll-back-available':
        return 'Check again';
      case 'up-to-date':
        return 'Check again';
      case 'error':
      case 'unsupported':
        return 'Retry';
      case 'idle':
      default:
        return 'Check for update';
    }
  })();

  const updateBadgeText = (() => {
    switch (updateCheck.status) {
      case 'available':
        return 'Update available';
      case 'roll-back-available':
        return 'Rollback available';
      case 'up-to-date':
        return 'Up to date';
      case 'checking':
        return 'Checking…';
      case 'error':
        return 'Check failed';
      case 'unsupported':
        return 'Dev client';
      case 'idle':
      default:
        return 'Not checked';
    }
  })();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={[styles.headerButton, { backgroundColor: colors.card }]}
            onPress={() => router.back()}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            accessibilityHint="Go back to the settings screen"
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text
              style={[styles.title, { color: colors.text }]}
              accessible
              accessibilityRole="header"
            >
              {t('settings.status_info.title')}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]} accessible>
              {t('settings.status_info.description')}
            </Text>
          </View>
        </View>

        {/* Build & OTA Section */}
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel="Build version and update status card"
        >
          <View style={styles.cardHeader}>
            <Ionicons name="build-outline" size={20} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Build & Updates</Text>
          </View>

          <View style={styles.buildGrid}>
            <View style={styles.buildItem}>
              <Text style={[styles.buildLabel, { color: colors.textSecondary }]}>
                Runtime Version
              </Text>
              <Text style={[styles.buildValue, { color: colors.text }]}>
                {runtimeInfo.runtimeVersion}
              </Text>
            </View>

            <View style={styles.buildItem}>
              <Text style={[styles.buildLabel, { color: colors.textSecondary }]}>
                Update Channel
              </Text>
              <Text
                style={[
                  styles.buildValue,
                  { color: colors.text, textTransform: 'capitalize' },
                ]}
              >
                {runtimeInfo.channel}
              </Text>
            </View>

            <View style={styles.buildItem}>
              <Text style={[styles.buildLabel, { color: colors.textSecondary }]}>
                Update ID
              </Text>
              <Text
                style={[styles.buildValue, { color: colors.text }]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {runtimeInfo.updateId
                  ? formatUpdateId(runtimeInfo.updateId, '(unknown)')
                  : runtimeInfo.isEmbedded
                    ? '(embedded build)'
                    : '(unknown)'}
              </Text>
            </View>

            {runtimeInfo.createdAt && (
              <View style={styles.buildItem}>
                <Text style={[styles.buildLabel, { color: colors.textSecondary }]}>
                  Applied
                </Text>
                <Text style={[styles.buildValue, { color: colors.text }]}>
                  {runtimeInfo.createdAt}
                </Text>
              </View>
            )}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.updateRow}>
            <View style={styles.updateLabelWrap}>
              <Text style={[styles.buildLabel, { color: colors.textSecondary }]}>
                Update Status
              </Text>
              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor:
                        updateStatusColor(updateCheck.status, colors) + '15',
                      borderColor: updateStatusColor(updateCheck.status, colors),
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusBadgeText,
                      { color: updateStatusColor(updateCheck.status, colors) },
                    ]}
                  >
                    {updateBadgeText}
                  </Text>
                </View>
                {updateCheck.newUpdateId &&
                  (updateCheck.status === 'available' ||
                    updateCheck.status === 'roll-back-available') && (
                    <Text
                      style={[styles.updateIdInline, { color: colors.textSecondary }]}
                      numberOfLines={1}
                      ellipsizeMode="middle"
                    >
                      {formatUpdateId(updateCheck.newUpdateId, '')}
                    </Text>
                  )}
              </View>
              {updateCheck.message ? (
                <Text style={[styles.updateMessage, { color: colors.textSecondary }]}>
                  {updateCheck.message}
                </Text>
              ) : null}
            </View>

            <TouchableOpacity
              style={[
                styles.updateButton,
                {
                  backgroundColor:
                    updateCheck.status === 'available' ||
                    updateCheck.status === 'roll-back-available'
                      ? colors.accent + '15'
                      : colors.card,
                  borderColor: updateStatusColor(updateCheck.status, colors),
                },
              ]}
              onPress={handleCheckForUpdate}
              disabled={updateCheck.status === 'checking'}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Check for available OTA update"
            >
              {updateCheck.status === 'checking' ? (
                <ActivityIndicator
                  size="small"
                  color={updateStatusColor(updateCheck.status, colors)}
                />
              ) : (
                <Text
                  style={[
                    styles.updateButtonText,
                    {
                      color:
                        updateCheck.status === 'available' ||
                        updateCheck.status === 'roll-back-available'
                          ? colors.accent
                          : colors.text,
                    },
                  ]}
                >
                  {updateCheckCta}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Connection Status Section */}
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel="Connection test and api details card"
        >
          <View style={styles.cardHeader}>
            <Ionicons name="wifi-outline" size={20} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {t('settings.status_info.network_status')}
            </Text>
          </View>

          <View style={styles.statusRow}>
            <View style={styles.statusLabelWrap}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>
                {t('settings.status_info.active_env')}
              </Text>
              <Text style={[styles.infoValue, { color: colors.text, textTransform: 'capitalize' }]}>
                {environmentConfig.label} ({environment})
              </Text>
            </View>

            <TouchableOpacity
              style={[
                styles.testButton,
                {
                  backgroundColor:
                    connectionStatus === 'online'
                      ? colors.success + '15'
                      : connectionStatus === 'offline'
                        ? colors.danger + '15'
                        : colors.card,
                  borderColor: getStatusColor(connectionStatus),
                },
              ]}
              onPress={handleTestConnection}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Test backend connectivity"
            >
              {connectionStatus === 'testing' ? (
                <ActivityIndicator size="small" color={colors.warning} />
              ) : (
                <Text
                  style={[
                    styles.testButtonText,
                    { color: getStatusColor(connectionStatus) || colors.text },
                  ]}
                >
                  {getStatusText(connectionStatus)}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {lastChecked && (
            <Text style={[styles.lastCheckedText, { color: colors.textSecondary }]}>
              {t('settings.status_info.last_checked', { time: lastChecked })}
            </Text>
          )}

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Environment Details */}
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
              {t('settings.status_info.api_url')}
            </Text>
            <Text style={[styles.detailValue, { color: colors.text }]} numberOfLines={1} ellipsizeMode="tail">
              {environmentConfig.apiBaseUrl || t('settings.network.endpoint_not_configured')}
            </Text>
          </View>

          <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
              {t('settings.status_info.stellar_net')}
            </Text>
            <Text style={[styles.detailValue, { color: colors.text, textTransform: 'capitalize' }]}>
              {environmentConfig.stellarNetwork}
            </Text>
          </View>

          <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
              {t('settings.status_info.soroban_rpc')}
            </Text>
            <Text style={[styles.detailValue, { color: colors.text }]} numberOfLines={1} ellipsizeMode="middle">
              {environmentConfig.sorobanRpcUrl || t('settings.network.endpoint_not_configured')}
            </Text>
          </View>

          {environmentConfig.crowdfundContractId ? (
            <>
              <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
                  {t('settings.status_info.contract_id')}
                </Text>
                <Text style={[styles.detailValue, { color: colors.text }]} numberOfLines={1} ellipsizeMode="middle">
                  {environmentConfig.crowdfundContractId}
                </Text>
              </View>
            </>
          ) : null}
        </View>

        {/* Release Notes / Changelog Section */}
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel="Changelog and release notes card"
        >
          <View style={styles.cardHeader}>
            <Ionicons name="list-circle-outline" size={20} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              {t('settings.status_info.notes_title')}
            </Text>
          </View>

          {releaseNotes.length === 0 ? (
            <Text style={[styles.noNotesText, { color: colors.textSecondary }]}>
              {t('settings.status_info.no_notes')}
            </Text>
          ) : (
            releaseNotes.map((release, idx) => (
              <View key={`${release.version}-${idx}`} style={styles.releaseContainer}>
                {idx > 0 && <View style={[styles.releaseDivider, { backgroundColor: colors.border }]} />}
                <View style={styles.releaseHeader}>
                  <Text style={[styles.releaseVersion, { color: colors.accent }]}>
                    {t('settings.status_info.version_prefix', { version: release.version })}
                  </Text>
                  {release.date && (
                    <Text style={[styles.releaseDate, { color: colors.textSecondary }]}>
                      {t('settings.status_info.published', { date: release.date })}
                    </Text>
                  )}
                </View>
                {release.title && (
                  <Text style={[styles.releaseTitle, { color: colors.text }]}>
                    {release.title}
                  </Text>
                )}
                <View style={styles.notesList}>
                  {release.notes.map((note, noteIdx) => (
                    <View key={noteIdx} style={styles.noteItem}>
                      <Text style={[styles.bulletPoint, { color: colors.accent }]}>•</Text>
                      <Text style={[styles.noteText, { color: colors.text }]}>{note}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
        </View>

        {/* Diagnostics Section */}
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
          accessible
          accessibilityLabel="Copy diagnostics card"
        >
          <View style={styles.cardHeader}>
            <Ionicons name="bug-outline" size={20} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Diagnostics</Text>
          </View>
          <Text style={[styles.diagnosticsBlurb, { color: colors.textSecondary }]}>
            Copy a build and environment snapshot to paste into a bug report. Wallet
            addresses and auth tokens are never included.
          </Text>
          <TouchableOpacity
            style={[
              styles.diagnosticsButton,
              {
                backgroundColor: diagnosticsCopied
                  ? colors.success + '15'
                  : colors.accent + '15',
                borderColor: diagnosticsCopied ? colors.success : colors.accent,
              },
            ]}
            onPress={handleCopyDiagnostics}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Copy diagnostics to clipboard for a bug report"
          >
            <Ionicons
              name={diagnosticsCopied ? 'checkmark-outline' : 'copy-outline'}
              size={18}
              color={diagnosticsCopied ? colors.success : colors.accent}
            />
            <Text
              style={[
                styles.diagnosticsButtonText,
                { color: diagnosticsCopied ? colors.success : colors.accent },
              ]}
            >
              {diagnosticsCopied ? 'Copied!' : 'Copy diagnostics'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* App Meta Section */}
        <View style={styles.metaContainer}>
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>
            {config.app.name} MVP — {config.app.version} ({config.app.variant})
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start',
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  buildGrid: {
    gap: 14,
  },
  buildItem: {},
  buildLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  buildValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 16,
  },
  updateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  updateLabelWrap: {
    flex: 1,
    gap: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  updateIdInline: {
    fontSize: 12,
    flexShrink: 1,
  },
  updateMessage: {
    fontSize: 13,
    marginTop: 2,
  },
  updateButton: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 110,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  statusLabelWrap: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  testButton: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  lastCheckedText: {
    fontSize: 11,
    marginTop: 6,
    textAlign: 'right',
  },
  detailDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  noNotesText: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },
  releaseContainer: {
    width: '100%',
  },
  releaseDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 16,
  },
  releaseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  releaseVersion: {
    fontSize: 15,
    fontWeight: '800',
  },
  releaseDate: {
    fontSize: 12,
  },
  releaseTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  notesList: {
    gap: 8,
  },
  noteItem: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  bulletPoint: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: -2,
  },
  noteText: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  diagnosticsBlurb: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  diagnosticsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  diagnosticsButtonText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  metaContainer: {
    alignItems: 'center',
    marginTop: 8,
  },
  metaText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
