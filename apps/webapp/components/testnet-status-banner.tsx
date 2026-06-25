"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle, RefreshCw, Wifi, WifiOff, ChevronDown, ChevronUp } from "lucide-react";

interface StatusData {
  network: string;
  dependencies: {
    api: "online" | "offline" | "unknown";
    rpc: "online" | "offline" | "unknown";
    indexer: "online" | "offline" | "unknown";
  };
}

export function TestnetStatusBanner() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const fetchStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/status");
      if (!response.ok) {
        throw new Error("Failed to fetch status");
      }
      const statusData: StatusData = await response.json();
      setData(statusData);
    } catch (err) {
      console.error("[TestnetStatusBanner]", err);
      setError("Status information currently unavailable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Poll status every 60 seconds
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  const getStatusBadge = (status: "online" | "offline" | "unknown") => {
    switch (status) {
      case "online":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Operational
          </span>
        );
      case "offline":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            Offline
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/5 text-white/40 border border-white/10">
            <span className="w-1.5 h-1.5 rounded-full bg-white/40" />
            Unknown
          </span>
        );
    }
  };

  if (loading && !data) {
    return (
      <div className="w-full bg-white/[0.01] border border-white/5 rounded-xl p-3.5 flex items-center justify-between text-xs text-foreground/40 animate-pulse">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-foreground/30 animate-spin" />
          <span>Retrieving Service Status...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-full bg-red-500/5 border border-red-500/10 rounded-xl p-3.5 flex items-center justify-between text-xs text-red-400/80">
        <div className="flex items-center gap-2">
          <WifiOff className="w-4 h-4 text-red-400" />
          <span>{error || "Status information currently unavailable"}</span>
        </div>
        <button
          onClick={fetchStatus}
          className="p-1 hover:bg-white/5 rounded transition-all text-foreground/50 hover:text-foreground"
          title="Retry fetching status"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const isDegraded = Object.values(data.dependencies).some(
    (status) => status !== "online"
  );

  return (
    <div className="w-full bg-white/[0.02] border border-white/5 rounded-xl p-3.5 backdrop-blur-md flex flex-col gap-3 transition-all duration-300">
      <div className="flex items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2">
          {isDegraded ? (
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          ) : (
            <Wifi className="w-4 h-4 text-emerald-400" />
          )}
          <span className="font-semibold text-foreground/80">
            {data.network} Active
          </span>
          <span className="text-foreground/40">| Service Status</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-lg border border-white/5 transition-all text-[11px]"
          >
            {isExpanded ? (
              <>
                Hide Details <ChevronUp className="w-3 h-3" />
              </>
            ) : (
              <>
                Show Details <ChevronDown className="w-3 h-3" />
              </>
            )}
          </button>
          <button
            onClick={fetchStatus}
            className="p-1 hover:bg-white/5 rounded-lg border border-transparent hover:border-white/5 transition-all text-foreground/50 hover:text-foreground"
            title="Refresh status"
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-white/5 animate-fadeIn">
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.01] border border-white/[0.03]">
            <span className="text-xs text-foreground/50">API</span>
            {getStatusBadge(data.dependencies.api)}
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.01] border border-white/[0.03]">
            <span className="text-xs text-foreground/50">Soroban RPC</span>
            {getStatusBadge(data.dependencies.rpc)}
          </div>
          <div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.01] border border-white/[0.03]">
            <span className="text-xs text-foreground/50">Indexer</span>
            {getStatusBadge(data.dependencies.indexer)}
          </div>
        </div>
      )}
    </div>
  );
}
