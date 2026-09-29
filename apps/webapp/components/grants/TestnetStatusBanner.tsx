"use client";

import { useState } from "react";
import { useTestnetStatus, DependencyStatus } from "@/hooks/useTestnetStatus";

// ── Status dot ────────────────────────────────────────────────
const statusConfig: Record<DependencyStatus, { color: string; label: string }> = {
  operational:  { color: "#22c55e", label: "Operational" },
  degraded:     { color: "#f59e0b", label: "Degraded" },
  unavailable:  { color: "#ef4444", label: "Unavailable" },
  unknown:      { color: "#94a3b8", label: "Unknown" },
};

function StatusDot({ status }: { status: DependencyStatus }) {
  const { color, label } = statusConfig[status];
  return (
    <span
      title={label}
      aria-label={label}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: color,
        flexShrink: 0,
        // Pulse animation only for degraded/unavailable
        animation: status === "operational" ? "none" : "pulse 2s infinite",
      }}
    />
  );
}

// ── Main banner ───────────────────────────────────────────────
export function TestnetStatusBanner() {
  const { networkName, dependencies, fetchedAt, isLoading, isUnavailable } =
    useTestnetStatus();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  // Determine overall health
  const overallStatus: DependencyStatus = isUnavailable
    ? "unknown"
    : dependencies.some(d => d.status === "unavailable")
    ? "unavailable"
    : dependencies.some(d => d.status === "degraded")
    ? "degraded"
    : dependencies.length > 0
    ? "operational"
    : "unknown";

  const { label: overallLabel } = statusConfig[overallStatus];

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .tsb-banner {
          font-family: ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
          font-size: 12px;
          background: #0f172a;
          border-bottom: 1px solid #1e293b;
          color: #94a3b8;
          padding: 6px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          min-height: 36px;
          position: relative;
          z-index: 40;
          user-select: none;
        }
        .tsb-network-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 4px;
          padding: 2px 8px;
          color: #7dd3fc;
          letter-spacing: 0.04em;
          font-weight: 600;
          white-space: nowrap;
        }
        .tsb-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          font-family: inherit;
          font-size: inherit;
          padding: 0;
        }
        .tsb-toggle:hover { color: #e2e8f0; }
        .tsb-toggle:focus-visible {
          outline: 2px solid #7dd3fc;
          outline-offset: 2px;
          border-radius: 2px;
        }
        .tsb-deps {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .tsb-dep {
          display: flex;
          align-items: center;
          gap: 5px;
          color: #cbd5e1;
        }
        .tsb-dep-name { color: #e2e8f0; }
        .tsb-latency { color: #64748b; font-size: 11px; }
        .tsb-spacer { flex: 1; }
        .tsb-timestamp { color: #475569; font-size: 11px; }
        .tsb-dismiss {
          background: none;
          border: none;
          color: #475569;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          padding: 2px 4px;
          border-radius: 3px;
        }
        .tsb-dismiss:hover { color: #94a3b8; background: #1e293b; }
        .tsb-unavailable-msg {
          color: #f59e0b;
          display: flex;
          align-items: center;
          gap: 6px;
        }
      `}</style>

      <div
        className="tsb-banner"
        role="status"
        aria-label={`${networkName} status: ${overallLabel}`}
        aria-live="polite"
      >
        {/* Network pill */}
        <div className="tsb-network-pill">
          <span aria-hidden="true">◈</span>
          {networkName}
        </div>

        {/* Status section */}
        {isLoading ? (
          <span style={{ color: "#475569" }}>Checking dependencies…</span>
        ) : isUnavailable ? (
          <span className="tsb-unavailable-msg">
            <StatusDot status="unknown" />
            Status unavailable
          </span>
        ) : (
          <>
            {/* Collapsed: just overall indicator */}
            <button
              className="tsb-toggle"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              aria-controls="tsb-dependency-list"
            >
              <StatusDot status={overallStatus} />
              <span>{overallLabel}</span>
              <span aria-hidden="true" style={{ fontSize: 10 }}>
                {expanded ? "▲" : "▼"}
              </span>
            </button>

            {/* Expanded: individual deps */}
            {expanded && (
              <div id="tsb-dependency-list" className="tsb-deps">
                <span style={{ color: "#334155", margin: "0 4px" }}>│</span>
                {dependencies.map(dep => (
                  <div key={dep.name} className="tsb-dep">
                    <StatusDot status={dep.status} />
                    <span className="tsb-dep-name">{dep.name}</span>
                    {dep.latencyMs !== undefined && (
                      <span className="tsb-latency">{dep.latencyMs}ms</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="tsb-spacer" />

        {/* Timestamp */}
        {fetchedAt && !isLoading && (
          <span className="tsb-timestamp">
            Updated {fetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}

        {/* Dismiss */}
        <button
          className="tsb-dismiss"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss testnet status banner"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    </>
  );
}