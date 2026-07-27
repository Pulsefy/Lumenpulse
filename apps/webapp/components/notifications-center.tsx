"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck, ExternalLink, ShieldAlert } from "lucide-react";

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  destination: string;
  read: boolean;
  type: string;
  createdAt: string;
};

type ApiResponse = {
  items?: NotificationItem[];
  source?: string;
};

export function NotificationsCenter() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<string | null>(null);

  const loadNotifications = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/notifications", { cache: "no-store" });
      const payload = (await response.json()) as ApiResponse;
      setItems(payload.items ?? []);
      setSource(payload.source ?? null);
    } catch {
      setItems([]);
      setSource("fallback");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadNotifications();
  }, []);

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);

  const markAsRead = async (id: string) => {
    try {
      const response = await fetch(`/api/notifications/${id}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw new Error("Failed to update notification");
      }
      const updated = (await response.json()) as NotificationItem;
      setItems((current) =>
        current.map((item) => (item.id === id ? { ...item, read: updated.read } : item)),
      );
    } catch {
      setItems((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
    }
  };

  const markAllAsRead = async () => {
    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw new Error("Failed to mark notifications as read");
      }
      const payload = (await response.json()) as { items?: NotificationItem[] };
      setItems(payload.items ?? []);
    } catch {
      setItems((current) => current.map((item) => ({ ...item, read: true })));
    }
  };

  return (
    <section className="rounded-3xl border border-primary/20 bg-black/70 p-6 shadow-2xl shadow-primary/10 backdrop-blur-xl">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Bell className="h-4 w-4" />
            Notification center
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-white">Stay on top of project, grant, and transaction updates</h2>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-primary">
            {unreadCount} unread
          </span>
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => void markAllAsRead()}
              className="rounded-full border border-white/10 px-3 py-1 text-sm text-white transition hover:border-primary/40 hover:text-primary"
            >
              Mark all as read
            </button>
          )}
        </div>
      </div>

      {source === "fallback" && (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <ShieldAlert className="h-4 w-4" />
          The backend is temporarily unavailable, so you are viewing the cached in-app preview.
        </div>
      )}

      {loading ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/70">
          Loading notifications…
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-10 text-center">
          <p className="text-lg font-medium text-white">No updates yet</p>
          <p className="mt-2 text-sm text-white/70">You are all caught up. New grant, project, and transaction activity will appear here.</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className={`rounded-2xl border p-4 transition ${item.read ? "border-white/10 bg-white/5" : "border-primary/30 bg-primary/10"}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-white/60">
                      {item.type}
                    </span>
                    {!item.read && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-black">
                        New
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-white/80">{item.body}</p>
                  <p className="mt-3 text-xs text-white/50">{new Date(item.createdAt).toLocaleString()}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Link
                    href={item.destination}
                    className="inline-flex items-center gap-2 rounded-full border border-primary/30 px-3 py-2 text-sm font-medium text-primary transition hover:bg-primary/20"
                  >
                    <ExternalLink className="h-4 w-4" />
                    View details
                  </Link>
                  <button
                    type="button"
                    onClick={() => void markAsRead(item.id)}
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition ${item.read ? "border border-white/10 bg-white/5 text-white/70" : "border border-primary/30 bg-primary/20 text-primary"}`}
                  >
                    <CheckCheck className="h-4 w-4" />
                    {item.read ? "Read" : "Mark as read"}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
