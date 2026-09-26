"use client";

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ExportType } from '@/lib/api-services';
import { useExports } from '@/hooks/useExports';
import { cn } from '@/lib/utils';

const EXPORT_TYPES: { value: ExportType; label: string; description: string; icon: string }[] = [
  {
    value: 'portfolio_history',
    label: 'Portfolio History',
    description: 'All portfolio snapshots with asset balances and USD values over time',
    icon: '📊',
  },
  {
    value: 'tax_transactions',
    label: 'Tax Transactions',
    description: 'Complete transaction history for tax reporting (up to 200 transactions)',
    icon: '📋',
  },
  {
    value: 'onchain_analytics',
    label: 'On-Chain Analytics',
    description: 'Daily sentiment averages and record counts from news insights (admin only)',
    icon: '🔗',
  },
  {
    value: 'round_analytics',
    label: 'Round Analytics',
    description: 'Daily snapshot data with asset symbols, sentiment, and signal counts (admin only)',
    icon: '📈',
  },
];

interface ExportActionDialogProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ExportActionDialog({ isOpen = false, onOpenChange }: ExportActionDialogProps) {
  const [selectedType, setSelectedType] = useState<ExportType | null>(null);
  const { requestExport, jobs } = useExports();

  const handleRequest = async () => {
    if (!selectedType) return;
    await requestExport(selectedType);
    setSelectedType(null);
    onOpenChange?.(false);
  };

  const isTypePending = (type: ExportType) => {
    return jobs.some((j) => j.type === type && (j.status === 'pending' || j.status === 'processing'));
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 border border-white/10 bg-zinc-950 p-6 shadow-xl sm:rounded-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
          <Dialog.Title className="text-xl font-semibold text-white">Request Data Export</Dialog.Title>
          <Dialog.Description className="text-sm text-zinc-400">
            Choose the type of data you want to export. Exports are processed asynchronously and
            will appear in the list below when ready.
          </Dialog.Description>

          <div className="space-y-2 py-2">
            {EXPORT_TYPES.map((type) => {
              const pending = isTypePending(type.value);
              return (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setSelectedType(type.value)}
                  disabled={pending}
                  className={cn(
                    'w-full text-left p-4 rounded-lg border transition-all duration-200',
                    'flex items-center gap-3',
                    selectedType === type.value
                      ? 'border-primary/50 bg-primary/10'
                      : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/5',
                    pending && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  <span className="text-2xl">{type.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{type.label}</p>
                    <p className="text-xs text-foreground/50 truncate">{type.description}</p>
                  </div>
                  {pending && (
                    <span className="px-2 py-1 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full">
                      Pending
                    </span>
                  )}
                  {selectedType === type.value && !pending && (
                    <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex gap-2 pt-2">
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex-1 px-4 py-2 text-sm font-medium text-foreground/80 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={handleRequest}
              disabled={!selectedType || isTypePending(selectedType ?? 'portfolio_history')}
              className={cn(
                'flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                'bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20',
                (!selectedType || isTypePending(selectedType ?? 'portfolio_history')) &&
                  'opacity-50 cursor-not-allowed'
              )}
            >
              Request Export
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}