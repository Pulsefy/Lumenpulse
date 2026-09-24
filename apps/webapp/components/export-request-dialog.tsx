"use client";

import { useState, useEffect } from "react";
import { Download, AlertCircle, Loader } from "lucide-react";
import { ExportType } from "@/types/export";
import { ExportApiService } from "@/lib/export-service";

interface ExportRequestDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onExportCreated: () => void;
  token: string;
  pendingExports: string[];
}

const EXPORT_TYPES = [
  {
    type: ExportType.PORTFOLIO_HISTORY,
    label: "Portfolio History",
    description: "Export your portfolio balance history with asset details and USD values.",
  },
  {
    type: ExportType.TAX_TRANSACTIONS,
    label: "Tax Transactions",
    description: "Export all transactions for tax reporting purposes.",
  },
];

export default function ExportRequestDialog({
  isOpen,
  onClose,
  onExportCreated,
  token,
  pendingExports,
}: ExportRequestDialogProps) {
  const [selectedType, setSelectedType] = useState<ExportType | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (type: ExportType) => {
    setIsLoading(true);
    setError(null);

    try {
      await ExportApiService.createExportJob(type, token);
      onExportCreated();
      setSelectedType(null);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create export";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const hasPendingExport = (type: ExportType) =>
    pendingExports.includes(type);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-white/10 rounded-xl shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="p-6 border-b border-white/10">
          <h2 className="text-xl font-bold text-white">Request Export</h2>
          <p className="text-gray-400 text-sm mt-1">
            Select the type of data you want to export
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex gap-2">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            {EXPORT_TYPES.map((exportOption) => {
              const isPending = hasPendingExport(exportOption.type);
              return (
                <div
                  key={exportOption.type}
                  className={`p-4 border rounded-lg cursor-pointer transition-all ${
                    isPending
                      ? "border-yellow-500/30 bg-yellow-500/5 opacity-60 cursor-not-allowed"
                      : "border-white/10 bg-gray-800/50 hover:border-blue-500/50 hover:bg-gray-800"
                  }`}
                  onClick={() => !isPending && !isLoading && handleSubmit(exportOption.type)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-white text-sm">
                        {exportOption.label}
                      </h3>
                      <p className="text-gray-400 text-xs mt-1">
                        {exportOption.description}
                      </p>
                    </div>
                    {isPending && (
                      <div className="ml-3 flex-shrink-0">
                        <AlertCircle className="w-4 h-4 text-yellow-500" />
                      </div>
                    )}
                  </div>
                  {isPending && (
                    <p className="text-xs text-yellow-600 mt-2">
                      Export already pending
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
