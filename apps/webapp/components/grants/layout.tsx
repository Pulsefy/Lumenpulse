import { TestnetStatusBanner } from "@/components/grants/TestnetStatusBanner";

export default function GrantsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TestnetStatusBanner />
      <main>{children}</main>
    </>
  );
}