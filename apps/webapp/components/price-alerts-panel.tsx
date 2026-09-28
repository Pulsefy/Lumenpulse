"use client";

import React, { useState } from 'react';
import { BellOff, BellRing, Pencil, Plus, Trash2, X } from 'lucide-react';
import { usePriceAlerts } from '@/hooks/use-price-alerts';
import {
  PRICE_ALERT_CHANNELS,
  PriceAlertFormErrors,
  PriceAlertFormValues,
  PriceAlertRule,
  PriceAlertState,
  getPriceAlertState,
  validatePriceAlertForm,
} from '@/lib/price-alert-service';
import { EmptyState } from '@/components/ui/empty-state';
import { ListError } from '@/components/ui/list-error';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { cn } from '@/lib/utils';

const EMPTY_FORM: PriceAlertFormValues = {
  symbol: '',
  targetPrice: '',
  condition: 'above',
  channel: 'in_app',
  cooldownMinutes: '60',
};

const STATE_STYLES: Record<PriceAlertState, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-green-500/10 text-green-400 border-green-500/20' },
  triggered: { label: 'Triggered', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  muted: { label: 'Muted', className: 'bg-white/5 text-gray-400 border-white/10' },
};

function describeRule(rule: PriceAlertRule): string {
  return `${rule.symbol} ${rule.condition} ${rule.targetPrice}`;
}

function formFromRule(rule: PriceAlertRule): PriceAlertFormValues {
  return {
    symbol: rule.symbol,
    targetPrice: String(rule.targetPrice),
    condition: rule.condition,
    // Channel is client-only (see PriceAlertChannel), so edits start from the default.
    channel: EMPTY_FORM.channel,
    cooldownMinutes: String(rule.cooldownMinutes),
  };
}

type FormMode = { kind: 'create' } | { kind: 'edit'; rule: PriceAlertRule };

export default function PriceAlertsPanel() {
  const {
    rules,
    isLoading,
    isSyncing,
    error,
    mutationError,
    clearMutationError,
    refresh,
    getRule,
    createRule,
    updateRule,
    removeRule,
  } = usePriceAlerts();

  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PriceAlertRule | null>(null);

  const openEdit = async (rule: PriceAlertRule) => {
    setLoadingEditId(rule.id);
    try {
      // Re-read the rule so the form starts from the server's latest values.
      const fresh = await getRule(rule.id);
      setFormMode({ kind: 'edit', rule: fresh });
    } catch {
      setFormMode({ kind: 'edit', rule });
    } finally {
      setLoadingEditId(null);
    }
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    // Optimistic: the row disappears now and returns (with an error banner) on failure.
    removeRule(id).catch(() => {});
  };

  const toggleMute = (rule: PriceAlertRule) => {
    updateRule(rule.id, { isActive: !rule.isActive }).catch(() => {});
  };

  let body: React.ReactNode;
  if (isLoading && rules.length === 0) {
    body = <ListSkeleton count={3} />;
  } else if (error && rules.length === 0) {
    body = <ListError message={error} onRetry={() => void refresh()} />;
  } else if (rules.length === 0) {
    body = (
      <EmptyState
        icon={BellRing}
        title="No price alerts yet"
        description="Get notified when an asset rises above or falls below a price you choose."
        action={{ label: 'Create alert', onClick: () => setFormMode({ kind: 'create' }) }}
      />
    );
  } else {
    body = (
      <ul className="space-y-2" aria-label="Price alert rules">
        {rules.map((rule) => {
          const state = getPriceAlertState(rule);
          const style = STATE_STYLES[state];
          const isOptimistic = rule.id.startsWith('temp-');
          return (
            <li
              key={rule.id}
              data-testid={`price-alert-${rule.id}`}
              className="flex items-center justify-between gap-3 p-3 rounded-lg border border-white/5 bg-white/[0.02]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{rule.symbol}</span>
                  <span
                    className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-full border', style.className)}
                    data-testid="price-alert-state"
                  >
                    {style.label}
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {rule.condition === 'above' ? 'Rises above' : 'Falls below'} {rule.targetPrice} · cooldown{' '}
                  {rule.cooldownMinutes} min
                  {state === 'triggered' && rule.lastTriggeredAt && (
                    <> · fired {new Date(rule.lastTriggeredAt).toLocaleString()}</>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => toggleMute(rule)}
                  disabled={isOptimistic}
                  aria-label={rule.isActive ? `Mute ${describeRule(rule)}` : `Unmute ${describeRule(rule)}`}
                  className="p-1.5 rounded hover:bg-white/5 text-gray-300 disabled:opacity-40"
                >
                  {rule.isActive ? <BellOff size={14} /> : <BellRing size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => void openEdit(rule)}
                  disabled={isOptimistic || loadingEditId === rule.id}
                  aria-label={`Edit ${describeRule(rule)}`}
                  className="p-1.5 rounded hover:bg-white/5 text-gray-300 disabled:opacity-40"
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(rule)}
                  disabled={isOptimistic}
                  aria-label={`Delete ${describeRule(rule)}`}
                  className="p-1.5 rounded hover:bg-red-500/10 text-red-400 disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="bg-black/40 border border-white/10 rounded-xl p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-white">Your alert rules</h2>
        <div className="flex items-center gap-3">
          {isSyncing && <span className="text-sm text-gray-400">Saving…</span>}
          <button
            type="button"
            onClick={() => setFormMode({ kind: 'create' })}
            className="px-3 py-1.5 bg-blue-500 rounded text-white text-sm flex items-center gap-2"
          >
            <Plus size={14} /> New alert
          </button>
        </div>
      </div>

      {mutationError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-2 mb-3 p-2 rounded border border-red-500/20 bg-red-500/10 text-sm text-red-300"
        >
          <span>{mutationError}</span>
          <button type="button" onClick={clearMutationError} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      {body}

      {formMode && (
        <PriceAlertFormDialog
          mode={formMode}
          onCancel={() => setFormMode(null)}
          onSubmit={async (values) => {
            const result = validatePriceAlertForm(values);
            if (!result.valid) return result.errors;
            if (formMode.kind === 'create') {
              await createRule(result.payload);
            } else {
              const { targetPrice, condition, cooldownMinutes } = result.payload;
              await updateRule(formMode.rule.id, { targetPrice, condition, cooldownMinutes });
            }
            setFormMode(null);
            return null;
          }}
        />
      )}

      {pendingDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-alert-title"
            aria-describedby="delete-alert-description"
            className="bg-gray-900 border border-white/10 rounded-xl p-6 w-96 max-w-[90vw]"
          >
            <h3 id="delete-alert-title" className="font-bold text-white mb-2">
              Delete price alert?
            </h3>
            <p id="delete-alert-description" className="text-sm text-gray-400 mb-4">
              {pendingDelete.symbol} {pendingDelete.condition} {pendingDelete.targetPrice} will stop notifying you.
              This can&apos;t be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="px-3 py-1.5 text-sm text-gray-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-3 py-1.5 text-sm bg-red-500 text-white rounded"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface PriceAlertFormDialogProps {
  mode: FormMode;
  onCancel: () => void;
  /** Resolves with field errors to show, or null on success. Rejects if the request failed. */
  onSubmit: (values: PriceAlertFormValues) => Promise<PriceAlertFormErrors | null>;
}

function PriceAlertFormDialog({ mode, onCancel, onSubmit }: PriceAlertFormDialogProps) {
  const isEdit = mode.kind === 'edit';
  const [values, setValues] = useState<PriceAlertFormValues>(
    isEdit ? formFromRule(mode.rule) : EMPTY_FORM,
  );
  const [errors, setErrors] = useState<PriceAlertFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (field: keyof PriceAlertFormValues) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => setValues((v) => ({ ...v, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const fieldErrors = await onSubmit(values);
      setErrors(fieldErrors ?? {});
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldProps = (field: keyof PriceAlertFormValues) => ({
    id: `price-alert-${field}`,
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `price-alert-${field}-error` : undefined,
    className: cn(
      'w-full p-2 rounded bg-white/5 text-white border',
      errors[field] ? 'border-red-500/60' : 'border-white/10',
    ),
  });

  const fieldError = (field: keyof PriceAlertFormValues) =>
    errors[field] ? (
      <p id={`price-alert-${field}-error`} className="text-xs text-red-400 mt-1">
        {errors[field]}
      </p>
    ) : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <form
        onSubmit={handleSubmit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-alert-form-title"
        className="bg-gray-900 border border-white/10 rounded-xl p-6 w-96 max-w-[90vw] space-y-3"
      >
        <div className="flex justify-between items-center">
          <h3 id="price-alert-form-title" className="font-bold text-white">
            {isEdit ? `Edit ${mode.rule.symbol} alert` : 'New price alert'}
          </h3>
          <button type="button" onClick={onCancel} aria-label="Close" className="text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div>
          <label htmlFor="price-alert-symbol" className="text-sm text-gray-300">
            Asset
          </label>
          <input
            {...fieldProps('symbol')}
            value={values.symbol}
            onChange={set('symbol')}
            placeholder="XLM"
            autoComplete="off"
            disabled={isEdit}
          />
          {isEdit && <p className="text-xs text-gray-500 mt-1">The asset can&apos;t be changed after creation.</p>}
          {fieldError('symbol')}
        </div>

        <div>
          <label htmlFor="price-alert-targetPrice" className="text-sm text-gray-300">
            Threshold price
          </label>
          <input
            {...fieldProps('targetPrice')}
            value={values.targetPrice}
            onChange={set('targetPrice')}
            inputMode="decimal"
            placeholder="0.15"
          />
          {fieldError('targetPrice')}
        </div>

        <div>
          <label htmlFor="price-alert-condition" className="text-sm text-gray-300">
            Direction
          </label>
          <select {...fieldProps('condition')} value={values.condition} onChange={set('condition')}>
            <option value="above">Rises above threshold</option>
            <option value="below">Falls below threshold</option>
          </select>
          {fieldError('condition')}
        </div>

        <div>
          <label htmlFor="price-alert-channel" className="text-sm text-gray-300">
            Notification channel
          </label>
          <select {...fieldProps('channel')} value={values.channel} onChange={set('channel')}>
            <option value="">Select a channel</option>
            {PRICE_ALERT_CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Per-alert channels aren&apos;t supported yet. Alerts are delivered using your notification preferences.
          </p>
          {fieldError('channel')}
        </div>

        <div>
          <label htmlFor="price-alert-cooldownMinutes" className="text-sm text-gray-300">
            Cooldown (minutes between alerts)
          </label>
          <input
            {...fieldProps('cooldownMinutes')}
            value={values.cooldownMinutes}
            onChange={set('cooldownMinutes')}
            inputMode="numeric"
          />
          {fieldError('cooldownMinutes')}
        </div>

        {submitError && (
          <p role="alert" className="text-sm text-red-400">
            {submitError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-400">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded disabled:opacity-60"
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create alert'}
          </button>
        </div>
      </form>
    </div>
  );
}
