'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ShieldAlert } from 'lucide-react';

interface Props {
  flagKey: string;
  /** Plain-language description of the change about to be applied. */
  changeLabel: string;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation step for flags marked sensitive.
 *
 * The operator has to type the flag key, so a change is never applied by a
 * single misplaced click. The backend enforces the same rule independently
 * (428 without `confirm: true`), so this dialog is the UX for the safeguard,
 * not the safeguard itself.
 */
export default function SensitiveConfirmDialog({
  flagKey,
  changeLabel,
  submitting,
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descId = useId();
  const matches = typed.trim() === flagKey;

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, submitting]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-background p-6 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-6 h-6 text-amber-400 shrink-0" />
          <h2 id={titleId} className="text-lg font-bold">
            Confirm change to a sensitive flag
          </h2>
        </div>
        <div id={descId} className="mt-3 space-y-2 text-sm text-foreground/70">
          <p>
            <code className="font-mono text-foreground">{flagKey}</code> is marked
            sensitive. You are about to:
          </p>
          <p className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 font-medium text-amber-200">
            {changeLabel}
          </p>
        </div>
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (matches && !submitting) onConfirm();
          }}
        >
          <label className="block text-xs text-foreground/50">
            Type <span className="font-mono text-foreground/80">{flagKey}</span> to
            confirm
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-foreground focus:border-amber-500/50 focus:outline-none"
            />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-sm bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!matches || submitting}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500/20 text-amber-200 border border-amber-500/30 hover:bg-amber-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Applying…' : 'Confirm change'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
