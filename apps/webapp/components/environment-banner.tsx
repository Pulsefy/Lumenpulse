// Shown on staging and PR preview deployments so they cannot be mistaken for
// production. NEXT_PUBLIC_ENV_LABEL is baked in at build time; it is unset in
// production builds, which renders nothing.
export function EnvironmentBanner() {
  const label = process.env.NEXT_PUBLIC_ENV_LABEL;
  if (!label) return null;
  return (
    <div
      role="status"
      data-testid="environment-banner"
      className="w-full bg-amber-500 px-4 py-1 text-center text-xs font-semibold text-black"
    >
      {label}
    </div>
  );
}
