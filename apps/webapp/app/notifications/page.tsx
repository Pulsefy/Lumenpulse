import { NotificationsCenter } from "@/components/notifications-center";

export default function NotificationsPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(219,116,207,0.12),_transparent_30%),linear-gradient(135deg,_rgba(10,10,15,0.95),_rgba(5,5,8,1))] px-4 py-24 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="max-w-3xl space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.35em] text-primary">Notification center</p>
          <h1 className="text-4xl font-semibold text-white sm:text-5xl">Review updates without losing context</h1>
          <p className="text-lg text-white/70">
            Jump from an unread project, grant, or transaction notification straight into the relevant experience.
          </p>
        </div>
        <NotificationsCenter />
      </div>
    </main>
  );
}
