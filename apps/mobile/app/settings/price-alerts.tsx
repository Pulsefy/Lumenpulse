import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTheme } from '../../contexts/ThemeContext';
import { usersApi } from '../../lib/api';
import {
  PRICE_ALERT_CONDITIONS,
  PriceAlertCondition,
  PriceAlertDraft,
  PriceAlertDraftErrors,
  PriceAlertRule,
  PriceAlertStatus,
  alertStatus,
  alertStatusLabel,
  deliveryEnabled,
  describePriceAlert,
  draftFromRule,
  emptyDraft,
  isDraftValid,
  isPendingRule,
  normalizeSymbol,
  priceAlerts,
  toUpdateInput,
  validatePriceAlertDraft,
} from '../../lib/price-alerts';

/**
 * PriceAlertSettingsScreen (issue #1404)
 *
 * List, create, edit and delete price alert rules. Rules are stored on the
 * backend (`/price-alerts`); when the device is offline the writes are queued
 * in `lib/mutation-queue.ts` and replayed on reconnect, so an alert created on
 * a plane is not lost.
 *
 * Reached from the notification settings screen. Any asset surface can prefill
 * the create form by navigating with a `symbol` param
 * (`router.push('/settings/price-alerts?symbol=XLM')`).
 */
export default function PriceAlertSettingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ symbol?: string }>();

  const [rules, setRules] = useState<PriceAlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [alertsDeliver, setAlertsDeliver] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [draft, setDraft] = useState<PriceAlertDraft>(() =>
    emptyDraft(normalizeSymbol(params.symbol ?? '')),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<PriceAlertDraftErrors>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [list, profile] = await Promise.all([priceAlerts.list(), usersApi.getProfile()]);

    setRules(list.rules);
    setPendingCount(list.pendingCount);
    setError(list.error?.message ?? null);

    if (profile.success) {
      setAlertsDeliver(deliveryEnabled(profile.data?.preferences?.notifications));
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      await load();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Reconnect: push any writes that were queued while offline first, so a
      // refreshed list is not missing the user's own edits.
      const flush = await priceAlerts.flushPending();
      if (flush.blocked) {
        Alert.alert('Some changes are still pending', 'They will be retried on the next refresh.');
      }
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setErrors({});
    setDraft(emptyDraft(normalizeSymbol(params.symbol ?? '')));
  }, [params.symbol]);

  const startEdit = useCallback((rule: PriceAlertRule) => {
    setEditingId(rule.id);
    setErrors({});
    setDraft(draftFromRule(rule));
  }, []);

  const handleSubmit = useCallback(async () => {
    const fieldErrors = validatePriceAlertDraft(draft);
    setErrors(fieldErrors);
    if (!isDraftValid(draft)) return;

    setSaving(true);
    try {
      const result = editingId
        ? await priceAlerts.update(editingId, toUpdateInput(draft) ?? {})
        : await priceAlerts.create(draft);

      if (!result.rule) {
        setError(result.error?.message ?? 'Could not save the alert');
        return;
      }

      await load();
      resetForm();
      if (result.queued) {
        Alert.alert('Saved offline', 'This alert will sync when you are back online.');
      }
    } finally {
      setSaving(false);
    }
  }, [draft, editingId, load, resetForm]);

  const handleDelete = useCallback(
    (rule: PriceAlertRule) => {
      Alert.alert('Delete this alert?', describePriceAlert(rule), [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusyId(rule.id);
            try {
              const result = await priceAlerts.remove(rule.id);
              if (!result.removed) {
                setError(result.error?.message ?? 'Could not delete the alert');
                return;
              }
              if (editingId === rule.id) resetForm();
              await load();
            } finally {
              setBusyId(null);
            }
          },
        },
      ]);
    },
    [editingId, load, resetForm],
  );

  const handleToggleActive = useCallback(
    async (rule: PriceAlertRule) => {
      setBusyId(rule.id);
      try {
        const result = await priceAlerts.update(rule.id, { isActive: !rule.isActive });
        if (!result.rule) {
          setError(result.error?.message ?? 'Could not update the alert');
          return;
        }
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const statusColors = useMemo(
    () => ({
      active: colors.success,
      triggered: colors.warning,
      muted: colors.textSecondary,
    }),
    [colors],
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/settings'))}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} accessibilityRole="header">
          Price alerts
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            accessibilityLabel="Pull to refresh price alerts"
          />
        }
      >
        {!alertsDeliver && (
          <View
            style={[styles.notice, { backgroundColor: colors.warning + '22' }]}
            accessible
            accessibilityRole="alert"
            accessibilityLabel="Price alert notifications are turned off in notification settings."
          >
            <Text style={[styles.noticeText, { color: colors.warning }]}>
              Price alert notifications are turned off in notification settings, so these rules will
              not fire until you switch them back on.
            </Text>
          </View>
        )}

        {pendingCount > 0 && (
          <View
            style={[styles.notice, { backgroundColor: colors.accent + '22' }]}
            accessible
            accessibilityRole="alert"
            accessibilityLabel={`${pendingCount} price alert changes waiting to sync`}
          >
            <Text style={[styles.noticeText, { color: colors.accent }]}>
              {pendingCount} change{pendingCount > 1 ? 's' : ''} waiting to sync. Pull to refresh to
              retry.
            </Text>
          </View>
        )}

        {error && (
          <Text
            style={[styles.errorBanner, { color: colors.danger }]}
            accessible
            accessibilityRole="alert"
          >
            {error}
          </Text>
        )}

        {/* Rule list */}
        {loading ? (
          <ActivityIndicator
            color={colors.accent}
            size="large"
            accessibilityLabel="Loading price alerts"
          />
        ) : rules.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textSecondary }]} accessible>
            No price alerts yet. Create one below to be notified when an asset crosses your target.
          </Text>
        ) : (
          rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              status={alertStatus(rule)}
              statusColor={statusColors[alertStatus(rule)]}
              busy={busyId === rule.id}
              syncing={isPendingRule(rule)}
              colors={colors}
              onEdit={startEdit}
              onDelete={handleDelete}
              onToggle={handleToggleActive}
            />
          ))
        )}

        {/* Create / edit form */}
        <View
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]} accessibilityRole="header">
            {editingId ? 'Edit alert' : 'New alert'}
          </Text>

          <Field
            label="Asset symbol"
            value={draft.symbol}
            onChangeText={(value) => setDraft((prev) => ({ ...prev, symbol: value }))}
            error={errors.symbol}
            colors={colors}
            testID="price-alert-symbol"
            autoCapitalize="characters"
            placeholder="XLM"
          />

          <Field
            label="Target price (USD)"
            value={draft.targetPrice}
            onChangeText={(value) => setDraft((prev) => ({ ...prev, targetPrice: value }))}
            error={errors.targetPrice}
            colors={colors}
            testID="price-alert-target"
            keyboardType="decimal-pad"
            placeholder="0.15"
          />

          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Condition</Text>
          <View style={styles.conditionRow}>
            {PRICE_ALERT_CONDITIONS.map((condition) => (
              <ConditionChip
                key={condition}
                condition={condition}
                selected={draft.condition === condition}
                colors={colors}
                onPress={() => setDraft((prev) => ({ ...prev, condition }))}
              />
            ))}
          </View>

          <Field
            label="Cooldown (minutes)"
            value={draft.cooldownMinutes}
            onChangeText={(value) => setDraft((prev) => ({ ...prev, cooldownMinutes: value }))}
            error={errors.cooldownMinutes}
            colors={colors}
            testID="price-alert-cooldown"
            keyboardType="number-pad"
            placeholder="60"
          />

          <View style={styles.formActions}>
            {editingId && (
              <TouchableOpacity
                onPress={resetForm}
                style={[styles.secondaryButton, { borderColor: colors.border }]}
                accessibilityRole="button"
                accessibilityLabel="Cancel editing this alert"
              >
                <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={saving}
              style={[styles.primaryButton, { backgroundColor: colors.accent, flex: 1 }]}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving }}
              accessibilityLabel={editingId ? 'Save price alert' : 'Create price alert'}
            >
              <Text style={styles.primaryButtonText}>
                {saving ? 'Saving…' : editingId ? 'Save alert' : 'Create alert'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type ThemeColors = ReturnType<typeof useTheme>['colors'];

function RuleRow({
  rule,
  status,
  statusColor,
  busy,
  syncing,
  colors,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: PriceAlertRule;
  status: PriceAlertStatus;
  statusColor: string;
  busy: boolean;
  syncing: boolean;
  colors: ThemeColors;
  onEdit: (rule: PriceAlertRule) => void;
  onDelete: (rule: PriceAlertRule) => void;
  onToggle: (rule: PriceAlertRule) => void;
}) {
  const accessibilityLabel = `${describePriceAlert(rule)}, ${alertStatusLabel(status)}${
    syncing ? ', waiting to sync' : ''
  }`;

  return (
    <View
      testID={`price-alert-${rule.id}`}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
      accessible
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.ruleHeader}>
        <Text style={[styles.ruleTitle, { color: colors.text }]}>
          {describePriceAlert(rule)}
        </Text>
        <View style={[styles.badge, { backgroundColor: statusColor + '22' }]}>
          <Text style={[styles.badgeText, { color: statusColor }]}>{alertStatusLabel(status)}</Text>
        </View>
      </View>

      <Text style={[styles.ruleMeta, { color: colors.textSecondary }]}>
        Fires at most every {rule.cooldownMinutes} minute{rule.cooldownMinutes === 1 ? '' : 's'}
        {rule.lastTriggeredAt
          ? ` · last fired ${new Date(rule.lastTriggeredAt).toLocaleString()}`
          : ' · never fired'}
      </Text>

      {syncing && (
        <Text style={[styles.ruleMeta, { color: colors.accent }]}>Waiting to sync…</Text>
      )}

      <View style={styles.ruleActions}>
        <TouchableOpacity
          onPress={() => onToggle(rule)}
          disabled={busy}
          style={[styles.secondaryButton, { borderColor: colors.border }]}
          accessibilityRole="switch"
          accessibilityState={{ checked: rule.isActive, disabled: busy }}
          accessibilityLabel={rule.isActive ? 'Mute this alert' : 'Unmute this alert'}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
            {rule.isActive ? 'Mute' : 'Unmute'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => onEdit(rule)}
          disabled={busy}
          style={[styles.secondaryButton, { borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel={`Edit ${describePriceAlert(rule)}`}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Edit</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => onDelete(rule)}
          disabled={busy}
          style={[styles.secondaryButton, { borderColor: colors.danger }]}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${describePriceAlert(rule)}`}
        >
          <Text style={[styles.secondaryButtonText, { color: colors.danger }]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ConditionChip({
  condition,
  selected,
  colors,
  onPress,
}: {
  condition: PriceAlertCondition;
  selected: boolean;
  colors: ThemeColors;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: selected ? colors.accent : colors.border,
          backgroundColor: selected ? colors.accent + '22' : 'transparent',
        },
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={condition === 'above' ? 'Fires when price rises above the target' : 'Fires when price falls below the target'}
    >
      <Text style={[styles.chipText, { color: selected ? colors.accent : colors.text }]}>
        {condition === 'above' ? 'Above' : 'Below'}
      </Text>
    </TouchableOpacity>
  );
}

function Field({
  label,
  value,
  onChangeText,
  error,
  colors,
  testID,
  keyboardType,
  autoCapitalize,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
  colors: ThemeColors;
  testID: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'characters';
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
      <TextInput
        testID={testID}
        style={[
          styles.input,
          {
            color: colors.text,
            borderColor: error ? colors.danger : colors.cardBorder,
            backgroundColor: colors.background,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
      />
      {error ? (
        <Text style={[styles.fieldError, { color: colors.danger }]} accessible accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  notice: { borderRadius: 12, padding: 12 },
  noticeText: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  errorBanner: { fontSize: 13, fontWeight: '500' },
  empty: { fontSize: 14, lineHeight: 20, textAlign: 'center', paddingVertical: 24 },
  card: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  ruleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ruleTitle: { fontSize: 15, fontWeight: '700', flex: 1, marginRight: 8 },
  ruleMeta: { fontSize: 12 },
  ruleActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 44, fontSize: 15 },
  fieldError: { fontSize: 12, fontWeight: '500' },
  conditionRow: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  chipText: { fontSize: 14, fontWeight: '600' },
  formActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  primaryButton: { height: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  primaryButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: { fontSize: 13, fontWeight: '600' },
});
