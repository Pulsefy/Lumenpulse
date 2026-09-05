import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  Share,
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
import { getReleaseMetadata, ReleaseInfo } from '../../lib/release-metadata';
import * as Updates from 'expo-updates';
import axios from 'axios';

type ConnectionStatus = 'idle' | 'testing' | 'online' | 'offline';

export default function StatusScreen() {
  const router = useRouter();
  const { colors, t } = useLocalization();
  const { environment, environmentConfig } = useEnvironment();
  const [releaseNotes, setReleaseNotes] = useState<ReleaseInfo[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [runtimeVersion, setRuntimeVersion] = useState<string>('N/A');
  const [updateId, setUpdateId] = useState<string>('N/A');
  const [channel, setChannel] = useState<string>('N/A');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateChecked, setUpdateChecked] = useState(false);
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);

  useEffect(() => {
    // Load release notes using utility helper
    const data = getReleaseMetadata();
    setReleaseNotes(data.releases);
    // Surface current update metadata from expo-updates (falls back to N/A in dev)
    setRuntimeVersion(Updates.runtimeVersion ?? 'N/A');
    setUpdateId(Updates.updateId ?? 'N/A');
    setChannel(Updates.channel ?? 'N/A');
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
      // Use axios or fetch with a 5 second timeout to test endpoint reachability
      const source = axios.CancelToken.source();
      const timeout = setTimeout(() => {
        source.cancel('Timeout');
      }, 5000);

      await axios.get(targetUrl, {
        cancelToken: source.token,
        validateStatus: () => true, // resolve on any status code (even 404 means server is up)
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

  const handleCheckForUpdate = async () => {
    if (checkingForUpdate) return;
    setCheckingForUpdate(true);
    setUpdateChecked(false);
    try {
      const result = await Updates.checkForUpdateAsync();
      setUpdateAvailable(result.isAvailable);
    } catch (error) {
      console.warn('Update check failed:', error);
      setUpdateAvailable(false);
    } finally {
      setUpdateChecked(true);
      setCheckingForUpdate(false);
    }
  };

  const handleCopyDiagnostics = async () => {
    const diagnostics = [
      `${config.app.name} MVP — ${config.app.version} (${config.app.variant})`,
      `Environment: ${environmentConfig.label} (${environment})`,
      `API URL: ${environmentConfig.apiBaseUrl || 'Not configured'}`,
      `Stellar Network: ${environmentConfig.stellarNetwork}`,
      `Soroban RPC: ${environmentConfig.sorobanRpcUrl || 'Not configured'}`,
      `Runtime Version: ${runtimeVersion}`,
      `Update ID: ${updateId}`,
      `Channel: ${channel}`,
      `Update checked: ${updateChecked ? (updateAvailable ? 'available' : 'up-to-date') : 'never'}`,
      `Last connection test: ${lastChecked || 'never'}`,
    ].join('\n');
    await Share.share({ message: diagnostics });
  };

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

        {/* Update Information Section */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="refresh-circle-outline" size={20} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Update Information</Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Runtime Version</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>{runtimeVersion}</Text>
          </View>

          <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Update ID</Text>
            <Text style={[styles.detailValue, { color: colors.text }]} numberOfLines={1} ellipsizeMode="middle">
              {updateId}
            </Text>
          </View>

          <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Channel</Text>
            <Text style={[styles.detailValue, { color: colors.text }]}>{channel}</Text>
          </View>

          <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Update</Text>
            <Text
              style={[
                styles.detailValue,
                {
                  color: updateChecked
                    ? updateAvailable
                      ? colors.success
                      : colors.textSecondary
                    : colors.textSecondary,
                },
              ]}
            >
              {!updateChecked
                ? 'Not checked'
                : updateAvailable
                  ? 'Update available'
                  : 'Up to date'}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.testButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                marginTop: 16,
              },
            ]}
            onPress={handleCheckForUpdate}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Check for updates"
          >
            {checkingForUpdate ? (
              <ActivityIndicator size="small" color={colors.warning} />
            ) : (
              <Text style={[styles.testButtonText, { color: colors.text }]}>Check for Updates</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Diagnostics Section */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="copy-outline" size={20} color={colors.accent} />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Copy Diagnostics</Text>
          </View>
          <TouchableOpacity
            style={[
              styles.testButton,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
            onPress={handleCopyDiagnostics}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Copy diagnostics"
          >
            <Text style={[styles.testButtonText, { color: colors.text }]}>Copy Diagnostics</Text>
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
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 16,
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
  metaContainer: {
    alignItems: 'center',
    marginTop: 8,
  },
  metaText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
