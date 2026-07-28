import type { Metadata } from "next";
import VerificationPageClient from "./VerificationPageClient";

export const metadata: Metadata = {
  title: "Project Verification - LumenPulse",
  description:
    "Community-driven project verification on LumenPulse. Vote on projects seeking Verified status and eligibility for quadratic funding matching on Stellar.",
  openGraph: {
    title: "Project Verification - LumenPulse",
    description:
      "Community-driven project verification on LumenPulse. Vote on projects seeking Verified status and eligibility for quadratic funding matching on Stellar.",
    url: "https://lumenpulse.app/verification",
    siteName: "LumenPulse",
    images: [{ url: "/assets/lumenpulse-03.png", width: 71, height: 71, alt: "LumenPulse" }],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Project Verification - LumenPulse",
    description:
      "Community-driven project verification on LumenPulse. Vote on projects seeking Verified status and eligibility for quadratic funding matching on Stellar.",
    images: ["/assets/lumenpulse-03.png"],
    creator: "@lumenpulse",
  },
};

export default function VerificationPage() {
  return <VerificationPageClient />;
}
