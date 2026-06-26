"use client";

import React, { useState } from "react";
import {
  Star,
  Trash2,
  GripVertical,
  Search,
  Filter,
  ExternalLink,
  Edit3,
  X,
  Check,
} from "lucide-react";
import { useWatchlist } from "@/hooks/use-watchlist";
import { WatchlistItem, WatchlistItemType } from "@/lib/watchlist-service";
import Image from "next/image";

interface WatchlistPanelProps {
  onSelectAsset?: (asset: { code: string; issuer?: string }) => void;
}

export default function WatchlistPanel({ onSelectAsset }: WatchlistPanelProps) {
  const { items, total, isLoading, error, removeItem, refresh } = useWatchlist();
  const [filterType, setFilterType] = useState<WatchlistItemType | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");

  const filteredItems = items.filter((item: WatchlistItem) => {
    const matchesType = filterType === "all" || item.type === filterType;
    const matchesSearch =
      !searchQuery ||
      item.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.name && item.name.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesType && matchesSearch;
  });

  const handleRemove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await removeItem(id);
    } catch {
      // Error is handled in context
    }
  };

  const handleEditNotes = (item: WatchlistItem) => {
    setEditingId(item.id);
    setEditNotes(item.notes || "");
  };

  const handleSaveNotes = () => {
    setEditingId(null);
    // Notes update can be added through the API if needed
  };

  const getTypeColor = (type: WatchlistItemType) => {
    return type === "asset"
      ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
      : "bg-purple-500/10 text-purple-400 border-purple-500/20";
  };

  if (isLoading) {
    return (
      <div className="bg-black/40 backdrop-blur-sm border border-white/10 rounded-xl p-4">
        <div className="flex justify-center items-center h-48">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black/40 backdrop-blur-sm border border-white/10 rounded-xl p-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold font-poppins text-white flex items-center gap-2">
          <Star size={20} className="text-yellow-400 fill-yellow-400" />
          Watchlist
          <span className="text-sm font-normal text-gray-400">
            ({total} {total === 1 ? "item" : "items"})
          </span>
        </h2>
        <button
          onClick={refresh}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Search and Filter */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            type="text"
            placeholder="Search watchlist..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg px-2">
          <Filter size={14} className="text-gray-500" />
          <select
            value={filterType}
            onChange={(e) =>
              setFilterType(e.target.value as WatchlistItemType | "all")
            }
            className="bg-transparent text-sm text-white focus:outline-none py-2 cursor-pointer"
          >
            <option value="all" className="bg-gray-900">
              All
            </option>
            <option value="asset" className="bg-gray-900">
              Assets
            </option>
            <option value="project" className="bg-gray-900">
              Projects
            </option>
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-red-400 text-sm mb-3 p-2 bg-red-500/10 rounded-lg">
          {error}
        </div>
      )}

      {/* Items List */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-8">
          <Star size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">
            {searchQuery || filterType !== "all"
              ? "No items match your filters"
              : "Your watchlist is empty"}
          </p>
          <p className="text-gray-500 text-xs mt-1">
            {searchQuery || filterType !== "all"
              ? "Try adjusting your search or filters"
              : "Star assets or projects to add them here"}
          </p>
        </div>
      ) : (
        <div className="space-y-1 max-h-[500px] overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          <style jsx>{`
            div::-webkit-scrollbar {
              display: none;
            }
          `}</style>
          {filteredItems.map((item) => (
            <div
              key={item.id}
              onClick={() =>
                onSelectAsset?.({
                  code: item.symbol,
                  issuer: item.assetIssuer || undefined,
                })
              }
              className="group flex items-center gap-3 p-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer border border-transparent hover:border-white/5"
            >
              {/* Drag Handle */}
              <GripVertical
                size={14}
                className="text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              />

              {/* Icon */}
              <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 flex items-center justify-center shrink-0 overflow-hidden">
                {item.imageUrl ? (
                  <Image
                    src={item.imageUrl}
                    alt={item.symbol}
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                ) : (
                  <span className="text-xs font-bold">
                    {item.symbol.substring(0, 2)}
                  </span>
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white text-sm">
                    {item.symbol}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border ${getTypeColor(item.type)}`}
                  >
                    {item.type}
                  </span>
                </div>
                {item.name && (
                  <p className="text-xs text-gray-400 truncate">{item.name}</p>
                )}
              </div>

              {/* Notes Indicator */}
              {item.notes && editingId !== item.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEditNotes(item);
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  title={item.notes}
                >
                  <Edit3 size={14} className="text-gray-500 hover:text-gray-300" />
                </button>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {onSelectAsset && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAsset({
                        code: item.symbol,
                        issuer: item.assetIssuer || undefined,
                      });
                    }}
                    className="p-1 rounded hover:bg-white/10 transition-colors"
                    title="View details"
                  >
                    <ExternalLink size={14} className="text-gray-400" />
                  </button>
                )}
                <button
                  onClick={(e) => handleRemove(item.id, e)}
                  className="p-1 rounded hover:bg-red-500/10 transition-colors"
                  title="Remove from watchlist"
                >
                  <Trash2 size={14} className="text-gray-400 hover:text-red-400" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Notes Modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-96 max-w-[90vw]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-white">Edit Notes</h3>
              <button
                onClick={() => setEditingId(null)}
                className="text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 resize-none h-32"
              placeholder="Add notes about this item..."
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setEditingId(null)}
                className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveNotes}
                className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-1"
              >
                <Check size={14} /> Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
