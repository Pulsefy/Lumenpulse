import type { Metadata } from "next";
import GrantsPageClient from "./GrantsPageClient";

export const metadata: Metadata = {
  title: "Grant Rounds - LumenPulse",
  description:
    "Browse community-funded quadratic funding rounds on LumenPulse. Discover active, upcoming, and finalized grant rounds supporting projects on Stellar.",
  openGraph: {
    title: "Grant Rounds - LumenPulse",
    description:
      "Browse community-funded quadratic funding rounds on LumenPulse. Discover active, upcoming, and finalized grant rounds supporting projects on Stellar.",
    url: "https://lumenpulse.app/grants",
    siteName: "LumenPulse",
    images: [{ url: "/assets/lumenpulse-03.png", width: 71, height: 71, alt: "LumenPulse" }],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Grant Rounds - LumenPulse",
    description:
      "Browse community-funded quadratic funding rounds on LumenPulse. Discover active, upcoming, and finalized grant rounds supporting projects on Stellar.",
    images: ["/assets/lumenpulse-03.png"],
    creator: "@lumenpulse",
  },
};

export default function GrantsPage() {
  return <GrantsPageClient />;
}
